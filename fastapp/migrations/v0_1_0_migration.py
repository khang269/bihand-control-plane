import logging
from typing import Dict, Any
from fastapp.migrations.base_migration import BaseMigration
from fastapp.models.instanceModel import InstanceModel

logger = logging.getLogger(__name__)

class Migration_0_1_0(BaseMigration):
    @property
    def version(self) -> str:
        return "0.1.0"

    @property
    def migration_id(self) -> str:
        return "v0_1_0_initial_gog_rekey"

    def upgrade_db(self, db) -> bool:
        logger.info("Upgrading database to schema version 0.1.0...")
        # Upgrades fleet schema versions
        db["fleets"].update_many(
            {"schemaVersion": {"$exists": False}},
            {"$set": {"schemaVersion": "0.1.0"}}
        )
        db["fleets"].update_many(
            {"schemaVersion": {"$lt": "0.1.0"}},
            {"$set": {"schemaVersion": "0.1.0"}}
        )

        # Upgrades instance schema versions
        db["instances"].update_many(
            {"schemaVersion": {"$exists": False}},
            {"$set": {"schemaVersion": "0.1.0"}}
        )
        db["instances"].update_many(
            {"schemaVersion": {"$lt": "0.1.0"}},
            {"$set": {"schemaVersion": "0.1.0"}}
        )
        return True

    def upgrade_vm(self, db, instance: Dict[str, Any]) -> bool:
        instance_id = str(instance["_id"])
        logger.info(f"Running live VM migration 0.1.0 for instance {instance_id} ({instance.get('vmName')})...")
        
        # If the instance has a bihand-google-workspace skill or active googleWorkspace integration,
        # run setup_google_workspace_tool_task which rebuilds everything cleanly
        enabled_skills = instance.get("enabledSkills", []) or []
        tool_connections = instance.get("toolConnections", {}) or {}
        has_google = "google-workspace" in enabled_skills or "googleWorkspace" in tool_connections
        
        if has_google:
            try:
                from fastapp.tasks import setup_google_workspace_tool_task
                setup_google_workspace_tool_task(instance_id)
                logger.info(f"Successfully re-authenticated Google Workspace tools for instance {instance_id}")
            except Exception as e:
                logger.error(f"Error re-running google workspace setup for {instance_id} during migration: {e}")
                return False
        else:
            # For non-google instances, just make sure heartbeat is loaded and clean of GOG secrets
            ip = instance.get("externalIp")
            private_key = instance.get("sshKeyPrivate")
            if ip and private_key:
                try:
                    from fastapp.services import sshService
                    # Check if service exists
                    chk = sshService.execute_command(ip, private_key, "systemctl list-unit-files | grep bihand-heartbeat.service || true")
                    if "bihand-heartbeat.service" in chk.get("stdout", ""):
                        # Re-write the service file slightly to load EnvironmentFile and avoid hardcoded credentials
                        update_cmd = (
                            "sudo sed -i '/Environment=GOG_/d' /etc/systemd/system/bihand-heartbeat.service || true\n"
                            "sudo grep -q 'EnvironmentFile=' /etc/systemd/system/bihand-heartbeat.service || "
                            "sudo sed -i '/\\[Service\\]/a EnvironmentFile=-/root/.bihand/google_workspace.env' /etc/systemd/system/bihand-heartbeat.service\n"
                            "sudo systemctl daemon-reload && sudo systemctl restart bihand-heartbeat.service || true"
                        )
                        sshService.execute_command(ip, private_key, update_cmd)
                        logger.info(f"Patched heartbeat systemd service for instance {instance_id}")
                except Exception as e:
                    logger.error(f"Failed to patch heartbeat service for non-google instance {instance_id}: {e}")
                    return False

        # Mark VM as successfully upgraded
        db["instances"].update_one(
            {"_id": instance["_id"]},
            {"$set": {"deployedVersion": "0.1.0"}}
        )
        return True
