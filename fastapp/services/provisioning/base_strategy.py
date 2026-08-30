from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
import base64
from fastapp.services import sshService

PROVIDER_CONFIG = {
    "google": {
        "provider": "gemini",
        "defaultModel": "gemini-3.5-flash",
        "envVars": {},
    },
    "gemini": {
        "provider": "gemini",
        "defaultModel": "gemini-3.5-flash",
        "envVars": {},
    },
    "openai": {
        "provider": "openai",
        "defaultModel": "gpt-4.1",
        "envVars": {},
    },
    "anthropic": {
        "provider": "anthropic",
        "defaultModel": "claude-sonnet-4-6",
        "envVars": {},
    },
    "deepseek": {
        "provider": "openai",  # DeepSeek uses OpenAI-compatible API
        "defaultModel": "deepseek-chat",
        "envVars": {
            "OPENAI_BASE_URL": "https://api.deepseek.com/v1",
        },
    },
    "bihand": {
        "provider": "openai",
        "defaultModel": "gemini-3.5-flash",
        "envVars": {},
    },
}

class BaseProvisioningStrategy(ABC):
    
    @abstractmethod
    def get_startup_script(self, provider: str, api_key: str, model: str, password: str, gateway_token: str, agent_type: str = "openclaw", api_url: str = "http://localhost:8501/api/internal", agent_md_b64: str = "", mcp_config_b64: str = "") -> str:
        """Generate the bash startup script for the VM."""
        pass
        
    @abstractmethod
    async def extract_token(self, instance_id: str, vm_name: str, zone: str, external_ip: str, logger_func, gateway_token: str) -> Optional[str]:
        """Extract the session/dashboard token after deployment."""
        pass

    @abstractmethod
    def get_workspace_path(self) -> str:
        """Return the physical workspace directory path on the VM."""
        pass

    def get_provider_config(self, provider: str) -> Dict[str, Any]:
        """Helper to get standardized provider config."""
        return PROVIDER_CONFIG.get(provider, PROVIDER_CONFIG["openai"])

    def _get_files_from_vm(self, ip: str, private_key: str, dir_path: str, max_depth: int = 1, file_pattern: str = "*.md") -> List[Dict[str, Any]]:
        cmd = f"sudo find {dir_path} -maxdepth {max_depth} -name '{file_pattern}' -printf '%P\\t%s\\n' || echo ''"
        files = []
        try:
            res = sshService.execute_command(ip, private_key, cmd)
            if res["exitCode"] == 0 and res["stdout"].strip():
                for line in res["stdout"].strip().split("\\n"):
                    if "\\t" in line:
                        fpath, fsize = line.split("\\t", 1)
                        if fpath:
                            cat_cmd = f"if [ -f '{dir_path}/{fpath}' ]; then sudo cat '{dir_path}/{fpath}' | base64; else echo ''; fi"
                            cat_res = sshService.execute_command(ip, private_key, cat_cmd)
                            content = ""
                            if cat_res["exitCode"] == 0:
                                try:
                                    decoded = base64.b64decode(cat_res["stdout"].strip()).decode('utf-8', errors='replace')
                                    if "No such file or directory" not in decoded and not decoded.startswith("cat: "):
                                        content = decoded
                                except Exception:
                                    pass
                            files.append({
                                "name": fpath.strip(),
                                "content": content
                            })
        except Exception:
            pass
        return files

    def _edit_files_on_vm(self, ip: str, private_key: str, dir_path: str, files: List[Dict[str, Any]], restart_cmd: str = "") -> bool:
        try:
            script = [f"sudo mkdir -p {dir_path}"]
            for f in files:
                name = f["name"]
                content_b64 = base64.b64encode((f.get("content", "")).encode('utf-8')).decode('utf-8')
                script.append(f"sudo mkdir -p {dir_path}/$(dirname '{name}')")
                script.append(f"echo \"{content_b64}\" | base64 -d | sudo tee {dir_path}/{name} >/dev/null")
            if restart_cmd:
                script.append(restart_cmd)
            
            cmd = " && ".join(script)
            res = sshService.execute_command(ip, private_key, f"bash -c '{cmd}'")
            return res["exitCode"] == 0
        except Exception:
            return False


    def _get_skills_from_vm(self, ip: str, private_key: str, dir_path: str) -> List[Dict[str, Any]]:
        cmd = f"sudo find {dir_path} -maxdepth 2 -name 'SKILL.md' -printf '%P\\t%s\\n' || echo ''"
        files = []
        try:
            res = sshService.execute_command(ip, private_key, cmd)
            if res["exitCode"] == 0 and res["stdout"].strip():
                lines = res["stdout"].strip().split("\n")
                for line in lines:
                    if "\t" in line:
                        fpath, fsize = line.split("\t", 1)
                        if fpath:
                            skill_name = fpath.split("/")[0] if "/" in fpath else fpath
                            cat_cmd = f"if sudo test -f '{dir_path}/{fpath}'; then sudo cat '{dir_path}/{fpath}' | base64; else echo ''; fi"
                            cat_res = sshService.execute_command(ip, private_key, cat_cmd)
                            content = ""
                            if cat_res["exitCode"] == 0:
                                try:
                                    decoded = base64.b64decode(cat_res["stdout"].strip()).decode('utf-8', errors='replace')
                                    if "No such file or directory" not in decoded and not decoded.startswith("cat: "):
                                        content = decoded
                                except Exception:
                                    pass
                            files.append({
                                "name": skill_name,
                                "content": content
                            })
            else:
                # If command fails or directory doesn't exist, raise exception to trigger controller fallback
                raise Exception("Skills directory find command returned empty or non-zero exit code")
        except Exception as e:
            logger.error(f"Failed to find skills in {dir_path} via SSH: {e}")
            raise e
        return files

    def _edit_skills_on_vm(self, ip: str, private_key: str, dir_path: str, skills: List[Dict[str, Any]]) -> bool:
        try:
            # Clean directory first
            sshService.execute_command(ip, private_key, f"sudo rm -rf {dir_path} && sudo mkdir -p {dir_path}")
            
            client = sshService._connect(ip, private_key)
            sftp = sshService._get_sudo_sftp(client)
            try:
                for s in skills:
                    name = s.get("name")
                    if not name:
                        continue
                    remote_dir = f"{dir_path}/{name}"
                    try:
                        sftp.mkdir(remote_dir)
                    except Exception:
                        pass
                    
                    content = s.get("content", "")
                    file_path = f"{remote_dir}/SKILL.md"
                    with sftp.open(file_path, "wb") as f:
                        f.write(content.encode('utf-8'))
            finally:
                sftp.close()
                client.close()
            return True
        except Exception as e:
            logger.error(f"Failed to edit skills on VM: {e}")
            return False

    def _get_specific_files_from_vm(self, ip: str, private_key: str, dir_path: str, file_names: List[str]) -> List[Dict[str, Any]]:
        files = []
        for name in file_names:
            cat_cmd = f"if sudo test -f '{dir_path}/{name}'; then sudo cat '{dir_path}/{name}' | base64; else echo ''; fi"
            cat_res = sshService.execute_command(ip, private_key, cat_cmd)
            content = ""
            if cat_res["exitCode"] == 0 and cat_res["stdout"].strip():
                try:
                    decoded = base64.b64decode(cat_res["stdout"].strip()).decode('utf-8', errors='replace')
                    if "No such file or directory" not in decoded and not decoded.startswith("cat: "):
                        content = decoded
                except Exception:
                    pass
            files.append({
                "name": name,
                "content": content
            })
        return files

    def _edit_specific_files_on_vm(self, ip: str, private_key: str, dir_path: str, instructions: List[Dict[str, Any]], allowed_names: List[str], restart_cmd: str = "") -> bool:
        try:
            script = [f"sudo mkdir -p {dir_path}"]
            for f in instructions:
                name = f.get("name")
                if name in allowed_names:
                    content_b64 = base64.b64encode((f.get("content", "")).encode('utf-8')).decode('utf-8')
                    script.append(f"echo \"{content_b64}\" | base64 -d | sudo tee {dir_path}/{name} >/dev/null")
            if restart_cmd:
                script.append(restart_cmd)
            
            cmd = " && ".join(script)
            res = sshService.execute_command(ip, private_key, f"bash -c '{cmd}'")
            return res["exitCode"] == 0
        except Exception:
            return False

    @abstractmethod
    def getInstructions(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def editInstructions(self, ip: str, private_key: str, instructions: List[Dict[str, Any]]) -> bool:
        pass

    @abstractmethod
    def getSkills(self, ip: str, private_key: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def editSkills(self, ip: str, private_key: str, skills: List[Dict[str, Any]]) -> bool:
        pass

    @abstractmethod
    def getAgentConfig(self, ip: str, private_key: str) -> str:
        pass

    @abstractmethod
    def editAgentConfig(self, ip: str, private_key: str, config_content: str) -> bool:
        pass

    @abstractmethod
    def getMcpConfig(self, ip: str, private_key: str) -> str:
        """Retrieve MCP JSON configuration directly from the remote VM."""
        pass

    @abstractmethod
    def editMcpConfig(self, ip: str, private_key: str, mcp_config: str) -> bool:
        """Overwrite MCP JSON configuration directly on the remote VM."""
        pass

    @abstractmethod
    def restartAgent(self, ip: str, private_key: str) -> bool:
        pass

    def get_instructions_matrix(self) -> Dict[str, str]:
        """Matrix mapping MongoDB fields to expected VM instruction files."""
        return {
            "agentMd": "AGENTS.md",
            "heartbeatMd": "HEARTBEAT.md",
            "soulMd": "SOUL.md",
            "toolsMd": "TOOLS.md",
        }

    def update_db_from_instructions(self, instance_id: str, files: List[Dict[str, Any]]) -> None:
        """Update instance specific settings in MongoDB based on file list dynamically using matrix mapping."""
        from fastapp.models.instanceModel import InstanceModel
        matrix = self.get_instructions_matrix()
        file_to_db = {file_name: db_field for db_field, file_name in matrix.items()}
        for f in files:
            name = f.get("name")
            content = f.get("content")
            db_field = file_to_db.get(name)
            if db_field == "agentMd":
                InstanceModel._updateConfig(instance_id, content, None, None, None)
            elif db_field == "soulMd":
                InstanceModel._updateConfig(instance_id, None, content, None, None)
            elif db_field == "toolsMd":
                InstanceModel._updateConfig(instance_id, None, None, content, None)
            elif db_field == "heartbeatMd":
                InstanceModel._setHeartbeatMd(instance_id, content)

    def fallback_instructions(self, instance: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Return fallback files built from local DB values when VM is offline."""
        from fastapp.services.agentProfileService import DEFAULT_AGENT_MD
        files = []
        for db_field, file_name in self.get_instructions_matrix().items():
            content = instance.get(db_field, "")
            if db_field == "agentMd" and not content:
                content = DEFAULT_AGENT_MD
            files.append({"name": file_name, "content": content or ""})
        return files
