"""
Admin Controller — endpoints for admin-only operations.
Admins can search users, provision/manage NemoClaw instances.
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional, Any
import asyncio

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, status, Body
from pydantic import BaseModel, Field

from fastapp.controllers.authController import get_current_user
from fastapp.models.userModel import UserModel
from fastapp.models.instanceModel import InstanceModel
from fastapp.services import gcpService, sshService
from fastapp.services.provisionerService import provision_instance
from fastapp.services.provisioning.base_strategy import PROVIDER_CONFIG
from fastapp.services import validatorService

logger = logging.getLogger(__name__)

adminRouter = APIRouter()

# --- Admin dependency ---
# Admin allowlist is entirely operator-configured via ADMIN_USER (comma-separated
# emails) in your own .env. No maintainer email ships as a default admin here.
import os
ADMIN_EMAILS = [e.strip() for e in os.getenv("ADMIN_USER", "").split(",") if e.strip()]


async def require_admin(auth_payload: dict = Depends(get_current_user)):
    """Dependency that ensures the current user is an admin."""
    email = auth_payload.get("email", "")
    if email not in ADMIN_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return auth_payload


# --- Request Models ---

class ProvisionRequest(BaseModel):
    userEmail: str = Field(..., description="Email of the user to provision for")
    provider: str = Field(..., description="Inference provider: gemini, openai, anthropic, deepseek")
    apiKey: str = Field(..., description="User's API key for the provider")
    zone: str = Field(default="us-central1-a", description="GCP zone")
    model: Optional[str] = Field(default=None, description="Model override (uses default if not set)")
    alias: str = Field(..., description="User-friendly name for this workspace")
    password: str = Field(..., description="Dashboard access password")

class KeyValidationRequest(BaseModel):
    provider: str
    apiKey: str

class AddCreditRequest(BaseModel):
    amount: int = Field(..., gt=0, description="Amount of credits to add")


# --- User Search ---

@adminRouter.get("/users", summary="Search users by name or email")
async def search_users(
    q: str = "",
    limit: int = 20,
    admin: dict = Depends(require_admin),
):
    """Search users by name or email substring. Returns up to `limit` results."""
    users = UserModel._searchUsers(q, limit)
    
    # For each user, check if they have an active instance
    results = []
    for user in users:
        results.append({
            **user,
            "instances": InstanceModel._listByUser(user["email"]),
            "hasInstance": len(InstanceModel._listByUser(user["email"])) > 0,
        })
    
    return {"users": results, "count": len(results)}


@adminRouter.get("/users/{email}", summary="Get user details with instance info")
async def get_user_detail(
    email: str,
    admin: dict = Depends(require_admin),
):
    """Get full user details including their instance (if any)."""
    user = UserModel._getUserByEmail(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    instance = InstanceModel._getByUser(email)
    
    return {
        "user": user,
        "instance": instance,
    }


@adminRouter.post("/users/{email}/credits", summary="Add credits to a user (Admin backdoor)")
async def add_user_credits(
    email: str,
    req: AddCreditRequest,
    admin: dict = Depends(require_admin),
):
    """Admin backdoor to manually add credits to a user account."""
    user = UserModel._getUserByEmail(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    success = UserModel._addCredits(email, req.amount)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to add credits")
        
    return {"message": f"Successfully added {req.amount} credits to {email}"}


@adminRouter.post("/validate-key", summary="Validate an LLM API key before provisioning")
async def validate_api_key(
    req: KeyValidationRequest,
    admin: dict = Depends(require_admin)
):
    """
    Check if the provided API key is valid for the chosen provider.
    Returns the status and available curated models.
    """
    is_valid, error = await validatorService.validate_key(req.provider, req.apiKey)
    
    if not is_valid:
        return {
            "valid": False,
            "error": error
        }
        
    return {
        "valid": True,
        "models": validatorService.get_popular_models(req.provider)
    }


# --- Instance Provisioning ---

@adminRouter.post("/instances", summary="One-click NemoClaw setup for a user")
async def provision_new_instance(
    req: ProvisionRequest,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    """
    Provision a new NemoClaw instance for a user.
    Creates a GCP VM with persistent disk and installs NemoClaw.
    This runs as a background task — use the WebSocket endpoint to stream logs.
    """
    # Validate provider
    if req.provider not in PROVIDER_CONFIG:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {list(PROVIDER_CONFIG.keys())}",
        )
    
    # Check user exists
    user = UserModel._getUserByEmail(req.userEmail)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if user already has an instance with the SAME alias
    existing = InstanceModel._listByUser(req.userEmail)
    if any(inst["alias"] == req.alias for inst in existing):
        raise HTTPException(
            status_code=409,
            detail=f"User already has an instance named '{req.alias}'. Choose a unique alias.",
        )
    
    # --- DOUBLE CHECK: Mandatory Backend Key Validation ---
    is_valid, error = await validatorService.validate_key(req.provider, req.apiKey)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"API Key Validation Failed: {error}. Deployment aborted for safety."
        )

    # Resolve model
    provider_config = PROVIDER_CONFIG[req.provider]
    model = req.model or provider_config["defaultModel"]
    
    # Generate unique names and SSH keys
    suffix = secrets.token_hex(4)
    vm_name = f"nc-{suffix}"
    disk_name = f"nc-disk-{suffix}"
    
    ssh_keys = sshService.generate_ssh_keypair()
    
    # Create instance record in DB
    instance = InstanceModel._createInstance(
        userId=req.userEmail,
        userHash=user.get("hash", ""),
        vmName=vm_name,
        zone=req.zone,
        machineType="e2-small",
        diskName=disk_name,
        diskSizeGb=64,
        provider=req.provider,
        model=model,
        alias=req.alias,
        sshKeyPrivate=ssh_keys["private"],
        sshKeyPublic=ssh_keys["public"],
        createdBy=admin["email"],
    )
    
    instance_id = instance["_id"]
    
    # Launch provisioning as Celery task
    from fastapp.tasks import provision_instance_task
    task = provision_instance_task.delay(
        instance_id,
        req.userEmail,
        req.provider,
        req.apiKey,
        req.password,
        ""
    )
    InstanceModel._updateTaskMetadata(instance_id, taskId=task.id)
    
    logger.info(f"Admin {admin['email']} started provisioning {vm_name} for {req.userEmail}")
    
    return {
        "message": "Provisioning started",
        "instanceId": instance_id,
        "vmName": vm_name,
        "status": "provisioning",
    }


# --- Instance Management ---

@adminRouter.get("/instances", summary="List all instances")
async def list_all_instances(
    status_filter: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    """List all NemoClaw instances across all users."""
    instances = InstanceModel._listAll(status_filter)
    
    # Sanitize sensitive data even for admin list view
    for inst in instances:
        inst.pop("sshKeyPrivate", None)
    
    return {"instances": instances, "count": len(instances)}


@adminRouter.get("/instances/{instance_id}", summary="Get instance details")
async def get_instance_detail(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """Get full instance details including provision logs."""
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    # Also get live status from GCP if instance is supposed to be running
    gcp_info = None
    if instance["status"] in ("running", "stopped", "installing"):
        try:
            gcp_info = gcpService.get_instance(instance["vmName"], instance["zone"])
        except Exception:
            pass
    
    # Don't send private key to frontend
    instance.pop("sshKeyPrivate", None)
    
    return {
        "instance": instance,
        "gcpInfo": gcp_info,
    }


@adminRouter.get("/instances/{instance_id}/logs/startup", summary="Get VM startup script execution logs")
async def get_startup_logs(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """Retrieve raw serial port output to diagnose the bash startup script."""
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    if instance["status"] in ("deleted", "provisioning"):
        if instance.get("startupLogs"):
            return {"logs": instance.get("startupLogs")}
        return {"logs": "VM has not been created yet or has been deleted."}
        
    if instance["status"] == "error":
        # If the instance errored and was deleted, the full log is saved in the startupLogs field
        if instance.get("startupLogs"):
            return {"logs": instance.get("startupLogs")}
        return {"logs": instance.get("errorMessage", "No error logs available.")}

    try:
        logs = gcpService.get_instance_serial_port_output(instance["vmName"], instance["zone"], port=2)
        return {"logs": logs}
    except Exception as e:
        return {"logs": f"Error retrieving logs: {str(e)}"}


@adminRouter.post("/instances/{instance_id}/stop", summary="Stop an instance")
async def stop_instance(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """Stop a running instance. Persistent disk is preserved."""
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    if instance["status"] != "running":
        raise HTTPException(status_code=400, detail=f"Cannot stop instance in '{instance['status']}' state")
    
    try:
        from fastapp.tasks import stop_instance_task
        InstanceModel._updateStatus(instance_id, "stopping_queued")
        stop_instance_task.delay(instance_id)
        logger.info(f"Admin {admin['email']} queued stop for instance {instance_id}")
        return {"message": "Stop task queued.", "status": "stopping_queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to queue instance stop: {e}")


@adminRouter.post("/instances/{instance_id}/start", summary="Start a stopped instance")
async def start_instance(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """Start a stopped instance."""
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    if instance["status"] != "stopped":
        raise HTTPException(status_code=400, detail=f"Cannot start instance in '{instance['status']}' state")
    
    try:
        from fastapp.tasks import start_instance_task
        InstanceModel._updateStatus(instance_id, "starting_queued")
        start_instance_task.delay(instance_id)
        logger.info(f"Admin {admin['email']} queued start for instance {instance_id}")
        return {"message": "Start task queued.", "status": "starting_queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to queue instance start: {e}")


@adminRouter.post("/instances/{instance_id}/snapshot", summary="Create a disk backup snapshot")
async def create_backup_snapshot(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """Create a snapshot of the instance's persistent disk for backup."""
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    snapshot_name = f"{instance['diskName']}-snap-{timestamp}"
    
    try:
        result = gcpService.create_snapshot(
            instance["diskName"], instance["zone"], snapshot_name
        )
        logger.info(f"Admin {admin['email']} created snapshot {snapshot_name}")
        return {"message": "Snapshot created", "snapshotName": snapshot_name, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create snapshot: {e}")


from fastapp.tasks import delete_instance_task

@adminRouter.delete("/instances/{instance_id}", summary="Delete instance and disk")
async def delete_instance(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """
    Delete the VM instance AND the persistent disk in the background. 
    This removes all resources associated with the instance group.
    """
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    # Immediately notify frontend that it's being deleted
    InstanceModel._updateStatus(instance_id, "deleting_queued")
    delete_instance_task.delay(instance_id)
    
    return {"message": "Instance and resources deletion queued.", "diskDeleted": True}


@adminRouter.delete("/instances/{instance_id}/full", summary="Delete instance AND disk")
async def delete_instance_full(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    """
    Fully decommission: delete both the VM and persistent disk via Celery queue.
    """
    instance = InstanceModel._getById(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    # Forward to the exact same Celery task
    InstanceModel._updateStatus(instance_id, "deleting_queued")
    delete_instance_task.delay(instance_id)
    
    return {"message": "Instance and resources deletion queued."}


@adminRouter.get("/server-logs", summary="Get recent backend server logs")
async def get_server_logs(
    lines: int = 500,
    admin: dict = Depends(require_admin),
):
    """Retrieve the most recent lines from the active server log file."""
    import os
    import glob
    from datetime import datetime
    
    log_dir = "logs"
    if not os.path.exists(log_dir):
        return {"logs": "No logs directory found."}
        
    # Find the most recent date directory
    date_dirs = sorted([d for d in os.listdir(log_dir) if os.path.isdir(os.path.join(log_dir, d))], reverse=True)
    if not date_dirs:
        return {"logs": "No log directories found."}
        
    recent_dir = os.path.join(log_dir, date_dirs[0])
    
    # Find the most recent log file in that directory
    log_files = glob.glob(os.path.join(recent_dir, "server_*.log"))
    if not log_files:
        return {"logs": f"No log files found in {recent_dir}"}
        
    # Sort by modification time
    latest_file = max(log_files, key=os.path.getmtime)
    
    try:
        with open(latest_file, "r", encoding="utf-8") as f:
            # Read last N lines
            file_lines = f.readlines()
            return {"logs": "".join(file_lines[-lines:])}
    except Exception as e:
        return {"logs": f"Error reading log file: {str(e)}"}

# --- Catalog ---

@adminRouter.get("/machine-catalog", summary="Get available machine types")
async def get_machine_catalog(admin: dict = Depends(require_admin)):
    """Return the available GCP machine types for the setup wizard."""
    return {
        "machines": gcpService.get_machine_catalog(),
        "providers": list(PROVIDER_CONFIG.keys()),
    }

# --- Admin User Fleet and Task Inspection ---

@adminRouter.get("/users/{email}/fleets", summary="Get all fleets for a specific user")
async def get_user_fleets(
    email: str,
    admin: dict = Depends(require_admin),
):
    from fastapp.models.fleetModel import FleetModel
    fleets = FleetModel._listByUser(email)
    return {"fleets": fleets}

@adminRouter.get("/fleets/{fleet_id}", summary="Get specific fleet with instances")
async def get_admin_fleet_details(
    fleet_id: str,
    admin: dict = Depends(require_admin),
):
    from fastapp.models.fleetModel import FleetModel
    from fastapp.models.instanceModel import InstanceModel
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    instances = InstanceModel._listByFleet(fleet_id)
    # Sanitize private keys
    for inst in instances:
        inst.pop("sshKeyPrivate", None)
        
    return {
        "fleet": fleet,
        "instances": instances
    }

@adminRouter.get("/fleets/{fleet_id}/tasks", summary="Get tasks backlog for a fleet")
async def get_admin_fleet_tasks(
    fleet_id: str,
    admin: dict = Depends(require_admin),
):
    from fastapp.models.taskModel import TaskModel
    tasks = TaskModel._listByFleet(fleet_id)
    return {"tasks": tasks}

@adminRouter.get("/tasks/{task_id}/comments", summary="Get task chat history & audit trails")
async def get_admin_task_comments(
    task_id: str,
    admin: dict = Depends(require_admin),
):
    from fastapp.models.commentModel import CommentModel
    comments = CommentModel._listByTask(task_id)
    return {"comments": comments}

@adminRouter.get("/instances/{instance_id}/logs", summary="Get agent run details & console log snapshot")
async def get_admin_instance_logs(
    instance_id: str,
    admin: dict = Depends(require_admin),
):
    instance = InstanceModel._getByIdWithKeys(instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
        
    return {
        "provisionLogs": instance.get("logs", []),
        "errorMessage": instance.get("errorMessage")
    }


@adminRouter.get("/users/{email}/credentials", summary="Get encrypted credentials list of a user")
async def get_user_credentials_for_admin(
    email: str,
    admin: dict = Depends(require_admin),
):
    """
    Get credentials of the target user for selection when provisioning on their behalf.
    """
    from fastapp.models.credentialModel import CredentialModel
    credentials = CredentialModel.list_by_user(email)
    return {"credentials": credentials}


class AdminCredentialCreateReq(BaseModel):
    name: str = Field(..., description="Name of the credential")
    type: str = Field(..., description="Type of credential (e.g. llm_api_key)")
    data: str = Field(..., description="The raw secret data to encrypt")


@adminRouter.post("/users/{email}/credentials", summary="Admin backdoor to create a new credential on behalf of a user")
async def admin_create_user_credential(
    email: str,
    req: AdminCredentialCreateReq,
    admin: dict = Depends(require_admin),
):
    """
    Admin-only endpoint to create a new credential on behalf of a target user.
    """
    # Check if target user exists
    user_doc = UserModel._getUserByEmail(email)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    from fastapp.models.credentialModel import CredentialModel
    doc = CredentialModel.create(user_id=email, name=req.name, cred_type=req.type, data=req.data)
    doc["data"] = "***"
    return {"message": "Credential created successfully by administrator", "credential": doc}


@adminRouter.post("/users/{email}/fleets", summary="Admin backdoor to provision a new company fleet on behalf of a user")
async def admin_provision_fleet(
    email: str,
    req: dict,  # Receive raw dict dynamically so FastAPI does not perform strict schema validation before processing
    admin: dict = Depends(require_admin),
):
    """
    Admin-only endpoint to provision a company fleet for a target user (WITH THAT USER'S CREDENTIALS).
    """
    # Check if target user exists
    user_doc = UserModel._getUserByEmail(email)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    from fastapp.controllers.fleetController import ProvisionFleetRequest
    from fastapp.models.fleetModel import FleetModel
    from fastapp.models.credentialModel import CredentialModel
    from fastapp.services.agentProfileService import DEFAULT_AGENT_MD
    import re

    # Parse payload as ProvisionFleetRequest manually
    try:
        req_obj = ProvisionFleetRequest.parse_obj(req)
    except Exception as parse_err:
        raise HTTPException(status_code=400, detail=f"Invalid payload format: {str(parse_err)}")

    # Calculate initial 1-day upfront price for all agents in the fleet
    total_credits = 0
    final_agents = req_obj.agents
    
    machine_credit_costs_per_day = {
        "e2-small": 100,
        "e2-medium": 200,
        "e2-standard-2": 400
    }
    
    for ag in final_agents:
        mtype = ag.machineType if hasattr(ag, 'machineType') and ag.machineType else "e2-small"
        total_credits += machine_credit_costs_per_day.get(mtype, 100)
    
    if req_obj.plan == "starter" and not final_agents:
        raise HTTPException(status_code=400, detail="Must provide at least 1 agent config for starter plan")
    elif req_obj.plan == "medium" and len(final_agents) < 2:
        raise HTTPException(status_code=400, detail="Must provide at least 2 agent configs for medium plan")

    # 1. Back-end Validation: Prevent Duplicates and Circular loops
    role_counts = {}
    for a in final_agents:
        role_upper = a.role.strip().upper()
        if role_upper in role_counts:
            role_counts[role_upper] += 1
            a.role = f"{a.role.strip()} {role_counts[role_upper]}"
        else:
            role_counts[role_upper] = 1

    # Cycle Detection on API payload
    for a in final_agents:
        if not a.reportsTo:
            continue
        visited = set()
        curr = a
        has_cycle = False
        while curr.reportsTo:
            if curr.id in visited:
                has_cycle = True
                break
            visited.add(curr.id)
            parent = next((p for p in final_agents if p.id == curr.reportsTo), None)
            if not parent:
                break
            curr = parent
        if has_cycle:
            a.reportsTo = None

    supported_providers = ["google", "gemini", "openai", "anthropic", "deepseek", "bihand"]

    for ag in final_agents:
        # Sanitize Skill Names and generate placeholders if custom skills files are empty
        sanitized_files = []
        for file in (ag.skillsFiles or []):
            raw_name = file.get("name") or "unnamed_skill"
            sanitized_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', raw_name).strip().lower()
            if not sanitized_name:
                continue
            content = file.get("content") or ""
            if not content.strip():
                content = f"# {sanitized_name}\nCustom instructions for {sanitized_name}."
            sanitized_files.append({"name": sanitized_name, "content": content})
        ag.skillsFiles = sanitized_files

        provider = ag.provider.lower() if ag.provider else ""
        if provider == "bihand":
            ag.model = "gemini-3.5-flash"
            ag.apiKey = "bihand-system-placeholder"

        if provider not in supported_providers:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported provider '{ag.provider}' for agent {ag.role}."
            )
            
        if not ag.model or not ag.model.strip():
            raise HTTPException(
                status_code=400,
                detail=f"Model name cannot be empty for agent {ag.role}."
            )

        if provider == "bihand":
            decrypted_api_key = "bihand-system-placeholder"
        else:
            if not ag.apiKey:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing API Key credential for agent {ag.role}."
                )
                
            # Retrieve and decrypt the credential
            creds_doc = CredentialModel.get_by_id(ag.apiKey)
            if not creds_doc:
                raise HTTPException(
                    status_code=400,
                    detail=f"API Key credential with ID '{ag.apiKey}' not found for agent {ag.role}."
                )
                
            if creds_doc.get("userId") != email:
                raise HTTPException(
                    status_code=403,
                    detail=f"Unauthorized access to credential for agent {ag.role}."
                )
                
            decrypted_api_key = creds_doc.get("decrypted_data")
            if not decrypted_api_key:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to decrypt API Key for agent {ag.role}."
                )
            
        # Validate the API key using validatorService
        is_valid, error_msg = await validatorService.validate_key(provider, decrypted_api_key)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid API Key for agent {ag.role} ({ag.provider}): {error_msg}"
            )

    # Ensure user has enough credits
    current_credits = user_doc.get("credits", 0)
    if current_credits < total_credits:
        raise HTTPException(status_code=402, detail=f"Insufficient credits. This fleet requires {total_credits} credits for the initial day of operations, but the user has {current_credits}.")

    # Deduct credits
    tx_details = {
        "action": "admin_provision_company_fleet",
        "fleetName": req_obj.name,
        "plan": req_obj.plan,
        "agentsCount": len(final_agents),
        "agentsLineup": [{
            "role": a.role,
            "title": a.title,
            "machineType": a.machineType,
            "iteration": a.agentType
        } for a in final_agents],
        "administeredBy": admin.get("email")
    }
    success = UserModel._deductCredits(email, total_credits, details=tx_details)
    if not success:
         raise HTTPException(status_code=402, detail="Failed to deduct credits. Please check user's balance.")

    # Create Fleet Record
    fleet = FleetModel._create(
        user_id=email,
        name=req_obj.name,
        plan=req_obj.plan,
        total_price=float(total_credits), # Store total_credits for compatibility
        agents=[a.dict() for a in final_agents],
        api_budget=float(req_obj.apiBudget),
        mission=req_obj.mission
    )
    
    # Create Initial Task if provided and has valid content
    if req_obj.initialTask and req_obj.initialTask.title.strip():
        from fastapp.models.taskModel import TaskModel
        TaskModel._create(
            fleet_id=fleet["_id"],
            title=req_obj.initialTask.title,
            description=req_obj.initialTask.description,
            status="todo"
        )

    # Kick off Celery task to provision the fleet infrastructure
    from fastapp.tasks import provision_fleet_task
    provision_fleet_task.delay(
        fleet["_id"],
        email,
        req_obj.password
    )
    
    return {
        "message": f"Fleet '{req_obj.name}' is being provisioned successfully.",
        "fleetId": fleet["_id"],
        "dashboardUrl": fleet["bihandUrl"]
    }


@adminRouter.delete("/users/{email}/fleets/{fleet_id}", summary="Admin backdoor to destroy an entire fleet and all resources for a specific user")
async def admin_delete_fleet(
    email: str,
    fleet_id: str,
    admin: dict = Depends(require_admin),
):
    """
    Admin-only endpoint to destroy a target user's company fleet and all resources.
    """
    from fastapp.models.fleetModel import FleetModel
    fleet = FleetModel._getById(fleet_id)
    if not fleet or fleet["userId"] != email:
        raise HTTPException(status_code=404, detail="Fleet not found for this user")
        
    if fleet.get("status") in ["deleting", "deleted"]:
        raise HTTPException(status_code=400, detail="Fleet is already being destroyed")
        
    # Mark fleet as deleting
    FleetModel._updateStatus(fleet_id, "deleting")
    
    from fastapp.database import get_db
    # Instantly update statuses and broadcast changes via WebSockets so the UI transitions immediately
    instances_cursor = get_db()["instances"].find({"fleetId": fleet_id, "status": {"$nin": ["deleted"]}})
    for inst in instances_cursor:
        try:
            InstanceModel._updateStatus(str(inst["_id"]), "deleting")
        except Exception as ws_err:
            logger.warning(f"Failed to broadcast individual deletion status for {inst.get('_id')}: {ws_err}")
            get_db()["instances"].update_one({"_id": inst["_id"]}, {"$set": {"status": "deleting"}})
    
    from fastapp.tasks import delete_fleet_task
    delete_fleet_task.delay(fleet_id)
        
    return {"message": "Fleet destruction initiated successfully by administrator"}

