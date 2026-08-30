"""
Provisioner Service — orchestrates the full NemoClaw deployment flow.

Steps:
1. Generate SSH key pair
2. Create persistent disk (if not exists)
3. Create VM with startup script
4. Wait for VM to be ready
5. SSH in and install NemoClaw
6. Run onboarding with user's provider config
7. Configure dashboard for remote access
8. Health-check the dashboard
"""

import logging
import asyncio
import time
import secrets
from typing import Optional, Callable

import httpx

from fastapp.models.instanceModel import InstanceModel
from fastapp.services import gcpService, sshService
from fastapp.services.provisioning import get_provisioning_strategy

logger = logging.getLogger(__name__)

def _get_upgraded_machine_type(base_type: str) -> str:
    """Return a more powerful machine type (double CPU/RAM) for faster installation."""
    mapping = {
        "e2-small": "e2-medium",
        "e2-medium": "e2-standard-2",
        "e2-standard-2": "e2-standard-4",
        "e2-standard-4": "e2-standard-8",
        "e2-standard-8": "e2-standard-16",
        "n2-standard-4": "n2-standard-8",
        "n2-standard-8": "n2-standard-16",
    }
    return mapping.get(base_type, "e2-standard-4")


async def _wait_for_nginx_ready(ip: str):
    """Poll the public IP on HTTP Port 80 until Nginx responds with 401 (meaning auth is live).
    Bypassing HTTPS/443 prevents packet fragmentation and MTU handshake timeout locks on GKE clusters."""
    async with httpx.AsyncClient(timeout=3.0, verify=False) as client:
        # Wait up to 60 minutes for full provisioning
        for attempt in range(720):
            try:
                # Poll http:// instead of https:// to bypass SSL frame sizes and MTU blackholes
                resp = await client.get(f"http://{ip}", follow_redirects=True)
                # The auth_basic config will return 401. The default Nginx page returns 200.
                if resp.status_code == 401:
                    return True
            except Exception:
                pass
            await asyncio.sleep(5)
    return False


async def _wait_for_http_ready(ip: str):
    """Poll the public IP on HTTP port 80 until any response is received (nginx started)."""
    async with httpx.AsyncClient(timeout=3.0, verify=False) as client:
        # Wait up to 60 minutes for full provisioning
        for attempt in range(720):
            try:
                resp = await client.get(f"http://{ip}", follow_redirects=False)
                # Any HTTP response means nginx has started and the startup script is complete
                return True
            except Exception:
                pass
            await asyncio.sleep(5)
    return False


async def provision_instance(
    instance_id: str,
    user_id: str,
    provider: str,
    api_key: str,
    password: str,
    iteration: str = "openclaw",
    on_log: Optional[Callable[[str], None]] = None,
):
    """
    Full provisioning flow. Runs as a background task.
    """
    
    def log(msg: str):
        logger.info(f"[{instance_id}] {msg}")
        InstanceModel._appendLog(instance_id, msg)
        if on_log:
            try:
                on_log(msg)
            except Exception:
                pass
    
    instance = InstanceModel._getByIdWithKeys(instance_id)
    if not instance:
        logger.error(f"Instance {instance_id} not found")
        return
        
    if instance.get("status") in ["deleting", "deleted"]:
        logger.warning(f"Instance {instance_id} was deleted before provisioning started. Aborting.")
        return
        
    from fastapp.controllers.instanceController import get_disk_size_gb

    vm_name = instance["vmName"]
    zone = instance["zone"]
    machine_type = instance["machineType"]
    disk_name = instance["diskName"]
    # Derive from the (possibly just-updated, on reconfigure) machine type rather than trusting
    # the stored diskSizeGb, so a resize always gets the current tier's disk size.
    disk_size = get_disk_size_gb(machine_type)
    model = instance["model"]
    dashboard_token = instance["dashboardToken"]
    ssh_private_key = instance["sshKeyPrivate"]
    ssh_public_key = instance["sshKeyPublic"]

    if provider == "bihand":
        from fastapp.utils.bihandKey import generate_bihand_api_key
        api_key = generate_bihand_api_key(user_id)
        model = "gemini-3.5-flash"

    try:
        # === Step 1: Create persistent disk ===
        # Create GCP labels from user email (GCP labels must be safe)
        safe_user = user_id.split("@")[0].lower()[:20].replace(".", "-")
        instance_hash = secrets.token_hex(3)
        
        labels = {
            "minerclaw-managed": "true",
            "minerclaw-owner": safe_user,
            "minerclaw-instance": instance_hash,
        }

        log(f"Skipping standalone persistent disk creation (using {disk_size}GB boot disk instead)...")
        InstanceModel._updateStatus(instance_id, "provisioning")

        # === Step 2: Create VM ===
        log("Creating VM instance (Autonomous Deployment)...")
        
        # Double check status right before blocking IO
        current = InstanceModel._getByIdWithKeys(instance_id)
        if not current or current.get("status") in ["deleting", "deleted"]:
            log("Provisioning aborted mid-flight (Instance deleted).")
            return
            
        # Deploy using the requested machine_type (default e2-small)
        upgraded_machine_type = machine_type
        log(f"Provisioning with machine type {upgraded_machine_type}...")

        # Generate startup script via strategy
        gateway_token = secrets.token_hex(16)
        strategy = get_provisioning_strategy(iteration)
        
        agent_type = instance.get("agentType") or iteration
        
        from fastapp.appConfig import getAppConfig
        import os
        app_config = getAppConfig(os.environ.get("ENV", "prod"))
        
        # Use BIHAND_PUBLIC_API_URL from environment or fallback to a default
        base_api_url = os.environ.get("BIHAND_PUBLIC_API_URL", "http://localhost:8501")
        internal_api_url = f"{base_api_url.rstrip('/')}/api/internal"
        
        import base64
        import json
        from fastapp.utils import mcp_normalizer
        agent_md = instance.get("agentMd", "")
        mcp_config = instance.get("mcpConfig", "{}")

        # Resolve ${cred:<key>} placeholders (e.g. Meta MCP's access token) against bound
        # credentials before baking the config into the VM startup script - the DB copy of
        # mcpConfig must stay a placeholder, only what's written to the VM gets the real secret.
        from fastapp.utils.mcpCredentials import resolve_mcp_config_secrets
        mcp_config = resolve_mcp_config_secrets(instance, mcp_config)

        # Systematically inject chrome-devtools-mcp integration into the agent configuration
        try:
            mcp_data = json.loads(mcp_config) if mcp_config else {}
            if not isinstance(mcp_data, dict):
                mcp_data = {}
            
            # Since incoming config might be in any format, extract the flat servers dict first
            servers = mcp_normalizer.extract_all_servers(json.dumps(mcp_data))
            servers["chrome-devtools"] = {
                "command": "npx",
                "args": [
                    "-y",
                    "chrome-devtools-mcp@latest",
                    "--no-usage-statistics",
                    "--experimentalVision",
                    "--autoConnect",
                    "--browser-url=http://127.0.0.1:9222"
                ]
            }
            # Reconstruct as standard claudecode format before passing to strategy for target-specific normalization
            mcp_config = json.dumps({"mcpServers": servers}, indent=2)
        except Exception as ex:
            logger.warning(f"Failed to auto-inject chrome-devtools MCP server: {ex}")

        # Normalize the custom MCP configuration specifically for the target strategy during VM bootstrap
        if agent_type == "openclaw":
            mcp_config = mcp_normalizer.normalize_to_openclaw(mcp_config)
        elif agent_type == "opencode":
            mcp_config = mcp_normalizer.normalize_to_opencode(mcp_config)
        elif agent_type == "codex":
            mcp_config = mcp_normalizer.normalize_to_codex(mcp_config)
        else: # claudecode and defaults
            mcp_config = mcp_normalizer.normalize_to_claudecode(mcp_config)

        agent_md_b64 = base64.b64encode(agent_md.encode('utf-8')).decode('utf-8')
        mcp_config_b64 = base64.b64encode(mcp_config.encode('utf-8')).decode('utf-8')

        # Subscription auth (bills inference against the user's own plan instead of api_key's
        # metered API usage): a `claude setup-token` token for claudecode, or the pasted
        # contents of `~/.codex/auth.json` (from `codex login`) for codex. Only pass this
        # kwarg for the two strategies that declare it - others would raise TypeError on an
        # unexpected keyword argument.
        extra_startup_kwargs = {}
        if agent_type in ("claudecode", "codex") and instance.get("oauthToken"):
            extra_startup_kwargs["oauth_token"] = instance.get("oauthToken")

        # Custom provider: an arbitrary OpenAI-compatible base URL supplied by the user instead
        # of a named provider. Only declared by codex/opencode/openclaw's get_startup_script.
        if provider == "custom" and instance.get("customBaseUrl") and agent_type in ("codex", "opencode", "openclaw"):
            extra_startup_kwargs["custom_base_url"] = instance.get("customBaseUrl")

        startup_script = strategy.get_startup_script(
            provider, api_key, model, password, gateway_token,
            agent_type=agent_type, api_url=internal_api_url,
            agent_md_b64=agent_md_b64, mcp_config_b64=mcp_config_b64,
            **extra_startup_kwargs
        )
        
        extra_metadata = {}
        
        result = await asyncio.to_thread(
            gcpService.create_instance,
            vm_name=vm_name,
            zone=zone,
            machine_type=upgraded_machine_type,
            disk_name=disk_name,
            ssh_pubkey=ssh_public_key,
            startup_script=startup_script,
            labels=labels,
            extra_metadata=extra_metadata,
            disk_size_gb=disk_size
        )
        
        external_ip = result.get("externalIp")
        if external_ip:
            InstanceModel._updateIp(instance_id, external_ip)
            log(f"VM created with IP: {external_ip}.")
        else:
            log("VM created, waiting for IP assignment...")
            # Poll for IP
            for _ in range(30):
                await asyncio.sleep(5)
                vm_info = await asyncio.to_thread(gcpService.get_instance, vm_name, zone)
                if vm_info and vm_info.get("externalIp"):
                    external_ip = vm_info["externalIp"]
                    InstanceModel._updateIp(instance_id, external_ip)
                    log(f"VM IP assigned: {external_ip}.")
                    break
            
            if not external_ip:
                raise Exception("VM created but no external IP was assigned")

        # === Step 3: Wait for Service Gateway ===
        log("Waiting for autonomous setup and service gateway...")
        InstanceModel._updateStatus(instance_id, "installing")

        if iteration in ["opencode", "claudecode", "codex"] or agent_type in ["opencode", "claudecode", "codex"]:
            ready = await _wait_for_http_ready(external_ip)
        else:
            ready = await _wait_for_nginx_ready(external_ip)

        if not ready:
            raise Exception("Service gateway did not become live within the timeout period. Check VM logs.")

        log("Remote workspace is live and ready.")

        await strategy.extract_token(instance_id, vm_name, zone, external_ip, log, gateway_token)

        # Sync and materialize required core skills (e.g. bihand-agent) onto the remote VM filesystem
        try:
            log("Synchronizing required core skills to the VM...")
            from fastapp.services.agentProfileService import sync_skills, get_merged_skills_snapshot
            enabled_skills = instance.get("enabledSkills", []) or []
            next_adapter_config, _, _ = sync_skills(instance, enabled_skills)
            InstanceModel._setAdapterConfig(instance_id, next_adapter_config)
            instance = InstanceModel._getByIdWithKeys(instance_id) or instance
            vm_skills = get_merged_skills_snapshot(instance)
            if vm_skills:
                sync_ok = strategy.editSkills(external_ip, ssh_private_key, vm_skills)
                if sync_ok:
                    log("Core skills (including bihand-agent) synchronized successfully.")
                else:
                    log("Warning: Core skills synchronization completed with warnings.")
        except Exception as skill_e:
            log(f"Warning: Failed to synchronize core skills during provisioning: {skill_e}")

        # === Step 5: Downgrade to Standard Machine Type ===
        # TEMPORARILY DISABLED: Skipping downgrade to test connectivity on the upgraded machine.
        # Keeping code for future reference.
        if False and upgraded_machine_type != machine_type:
            log(f"Installation complete. Restarting VM to downgrade machine type back to {machine_type}...")
            
            # Stop the instance
            await asyncio.to_thread(gcpService.stop_instance, vm_name, zone)
            log("VM stopped.")
            
            # Change machine type
            await asyncio.to_thread(gcpService.set_machine_type, vm_name, zone, machine_type)
            log(f"Machine type changed to {machine_type}.")
            
            # Start the instance again
            await asyncio.to_thread(gcpService.start_instance, vm_name, zone)
            log("VM starting... waiting for IP and services to come back online.")
            
            # Refresh IP (just in case, though it's usually the same if external)
            for _ in range(30):
                await asyncio.sleep(5)
                vm_info = await asyncio.to_thread(gcpService.get_instance, vm_name, zone)
                if vm_info and vm_info.get("externalIp"):
                    external_ip = vm_info["externalIp"]
                    InstanceModel._updateIp(instance_id, external_ip)
                    break
            
            # Wait for Nginx to respond again after reboot (ensures proxy and nemoclaw restarted)
            log("Waiting for NemoClaw and Nginx proxy to restart...")
            ready_after_reboot = await _wait_for_nginx_ready(external_ip)
            if not ready_after_reboot:
                raise Exception("Services did not come back online after rebooting to standard machine type.")
                
            log("Explicitly restarting NemoClaw and Nginx via SSH to ensure clean state...")
            try:
                # Use a more robust restart sequence that waits for port availability and ensures PATH
                restart_cmd = (
                    "sudo systemctl restart docker && "
                    "sudo systemctl restart nginx && "
                    "export PATH=\"$PATH:/root/.local/bin:/usr/local/bin\" && "
                    "sudo -i bash -c 'export PATH=\"$PATH:/root/.local/bin:/usr/local/bin\" && source /root/.bashrc && openshell gateway stop --name nemoclaw || true' && "
                    "sleep 5 && "
                    "sudo -i bash -c 'export PATH=\"$PATH:/root/.local/bin:/usr/local/bin\" && source /root/.bashrc && openshell gateway start --name nemoclaw' && "
                    "sleep 10 && "
                    "sudo -i bash -c 'export PATH=\"$PATH:/root/.local/bin:/usr/local/bin\" && source /root/.bashrc && nemoclaw onboard --non-interactive || true' && "
                    "sleep 5 && "
                    "sudo -i bash -c 'export PATH=\"$PATH:/root/.local/bin:/usr/local/bin\" && source /root/.bashrc && nemoclaw start || true' && "
                    "for i in {{1..30}}; do if ss -lnt | grep -q :18789; then echo 'PORT_UP'; sudo systemctl reload nginx; break; fi; sleep 2; done"
                )
                restart_result = await asyncio.to_thread(
                    sshService.execute_command,
                    external_ip,
                    ssh_private_key,
                    restart_cmd
                )
                log(f"Restart script output: {restart_result.get('stdout', '')}")
                if restart_result.get('stderr'):
                    log(f"Restart script errors: {restart_result.get('stderr', '')}")
                log("Services successfully restarted on standard machine type.")
            except Exception as ssh_e:
                log(f"Warning: Failed to restart services explicitly via SSH: {ssh_e}")
                log("Services successfully restarted via startup script on standard machine type.")

        # === Done ===
        InstanceModel._updateStatus(instance_id, "running")
        log("=== Provisioning complete! Instance is ready. ===")

        try:
            log("Clearing startup script to prevent re-execution on future boots...")
            await asyncio.to_thread(gcpService.clear_startup_script, vm_name, zone)
        except Exception as e:
            log(f"Warning: Failed to clear startup script: {e}")

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Provisioning failed for {instance_id}: {error_msg}")
        log(f"ERROR: {error_msg}")
        
        # Try to capture the VM startup logs before we delete it, to help debug failures
        try:
            vm_logs = await asyncio.to_thread(gcpService.get_instance_serial_port_output, vm_name, zone, 2)
            if vm_logs:
                InstanceModel._updateStatus(instance_id, "error", errorMessage=f"{error_msg}", startupLogs=vm_logs)
            else:
                InstanceModel._updateStatus(instance_id, "error", errorMessage=error_msg)
        except Exception as log_e:
            logger.warning(f"Could not fetch VM logs before cleanup: {log_e}")
            InstanceModel._updateStatus(instance_id, "error", errorMessage=error_msg)
            
        log("Initiating emergency cleanup (removing VM and Disk)...")
        
        # Cleanup VM
        try:
            await asyncio.to_thread(gcpService.delete_instance, vm_name, zone)
            log(f"Successfully removed failed VM: {vm_name}")
        except Exception as ve:
            log(f"Cleanup: VM removal skipped or failed: {ve}")

        # Refund credits
        try:
            from fastapp.models.userModel import UserModel
            from fastapp.controllers.instanceController import MACHINE_COST_MULTIPLIER
            if instance.get("expiresAt") and instance.get("createdDate"):
                duration_td = instance["expiresAt"] - instance["createdDate"]
                duration_days = duration_td.days
            else:
                duration_days = 1
            cost_multiplier = MACHINE_COST_MULTIPLIER.get(instance.get("machineType", "e2-small"), 1)
            total_cost = duration_days * cost_multiplier
            if total_cost > 0:
                UserModel._addCredits(user_id, total_cost)
                log(f"Refunded {total_cost} credits to user due to provisioning failure.")
        except Exception as refund_e:
            log(f"Warning: Failed to refund credits: {refund_e}")

        InstanceModel._updateStatus(instance_id, "error", errorMessage=f"{error_msg} (Resources cleaned up)")
