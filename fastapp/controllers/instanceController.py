"""
Instance Controller — user-facing endpoints for their NemoClaw instance.
Users can view their instance status and manage files (upload/download/browse).
Users CANNOT create or delete instances — that is admin-only.
"""

import logging
import os
import secrets
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query, status, BackgroundTasks
from fastapi.responses import StreamingResponse
import io
from pydantic import BaseModel

from fastapp.controllers.authController import get_current_user
from fastapp.models.instanceModel import InstanceModel
from fastapp.models.userModel import UserModel
from fastapp.services.provisionerService import provision_instance
from fastapp.services.provisioning.base_strategy import PROVIDER_CONFIG
from fastapp.services import sshService, gcpService
from fastapp.services import validatorService
from fastapp.utils.adminAuth import ADMIN_EMAILS

logger = logging.getLogger(__name__)

instanceRouter = APIRouter()

# Default file browsing root
DEFAULT_ROOT = "/root/.openclaw"


class ProvisionRequest(BaseModel):
    provider: str
    apiKey: str
    password: str
    zone: str = "us-central1-a"
    model: Optional[str] = None
    alias: str = "My Agent"
    machineType: str = "e2-small"
    iteration: str = "openclaw"

class VerifyKeyRequest(BaseModel):
    provider: str
    apiKey: str

class ExtendRequest(BaseModel):
    durationDays: int

MACHINE_COST_MULTIPLIER = {
    "e2-small": 100,
    "e2-medium": 200,
    "e2-standard-2": 400,
    "e2-standard-4": 800,
    "e2-standard-8": 1600,
    "n2-standard-4": 1200,
}

# Boot disk size per machine tier. "Medium" and "Large/High" tiers get bumped
# storage; other (non-user-facing) tiers keep the original default.
MACHINE_DISK_SIZE_GB = {
    "e2-small": 64,
    "e2-medium": 128,
    "e2-standard-2": 256,
}

def get_disk_size_gb(machine_type: str) -> int:
    return MACHINE_DISK_SIZE_GB.get(machine_type, 64)

@instanceRouter.post("/verify-key", summary="Verify an API key before provisioning")
async def verify_user_key(req: VerifyKeyRequest, auth_payload: dict = Depends(get_current_user)):
    is_valid, error = await validatorService.validate_key(req.provider, req.apiKey)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)
    return {"message": "Key is valid"}

async def _get_user_instance_by_id(instance_id: str, auth_payload: dict):
    """Helper: get the current user's specific instance by ID or raise 404."""
    email = auth_payload.get("email")
    user_role = auth_payload.get("role", "user")
    if email in ADMIN_EMAILS:
        user_role = "admin"
    instance = InstanceModel._getById(instance_id)
    if not instance or (instance.get("userId") != email and user_role != "admin") or instance.get("status") == "deleted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instance not found or access denied.",
        )
    return instance


# --- Instance Status ---

@instanceRouter.post("/provision", summary="Provision your NemoClaw instance")
async def provision_my_instance(
    req: ProvisionRequest,
    background_tasks: BackgroundTasks,
    auth_payload: dict = Depends(get_current_user),
):
    email = auth_payload.get("email")
    user = UserModel._getUserByEmail(email)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.machineType not in MACHINE_COST_MULTIPLIER:
        raise HTTPException(status_code=400, detail="Invalid machine type.")
        
    if req.iteration == "nemoclaw" and req.machineType in ["e2-small", "e2-medium"]:
        raise HTTPException(status_code=400, detail="NemoClaw requires at least e2-standard-2 machine type.")
        
    cost_multiplier = MACHINE_COST_MULTIPLIER[req.machineType]
    first_day_cost = cost_multiplier
        
    if user.get("credits", 0) < first_day_cost:
        pass  # OSS build: no credit/billing gating (BYOK — bring your own GCP + LLM key)
        
    # --- DOUBLE CHECK: Mandatory Backend Key Validation ---
    is_valid, error = await validatorService.validate_key(req.provider, req.apiKey)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"API Key Validation Failed: {error}. Deployment aborted for safety."
        )

    # Deduct first day credit
    tx_details = {
        "action": "provision_individual_instance",
        "alias": req.alias,
        "machineType": req.machineType,
        "iteration": req.iteration,
        "provider": req.provider
    }
    if not UserModel._deductCredits(email, first_day_cost, details=tx_details):
        raise HTTPException(status_code=400, detail="Failed to deduct credits. Try again later.")

    # Resolve model
    provider_config = PROVIDER_CONFIG.get(req.provider, PROVIDER_CONFIG["openai"])
    model = req.model or provider_config["defaultModel"]
    
    # Generate unique names and SSH keys
    suffix = secrets.token_hex(4)
    vm_name = f"nc-{suffix}"
    disk_name = f"nc-disk-{suffix}"
    
    ssh_keys = sshService.generate_ssh_keypair()
    
    # Create instance record in DB
    try:
        instance = InstanceModel._createInstance(
            userId=email,
            userHash=user.get("hash", ""),
            vmName=vm_name,
            zone=req.zone,
            machineType=req.machineType,
            diskName=disk_name,
            diskSizeGb=get_disk_size_gb(req.machineType),
            provider=req.provider,
            model=model,
            alias=req.alias,
            sshKeyPrivate=ssh_keys["private"],
            sshKeyPublic=ssh_keys["public"],
            createdBy=email,
            iteration=req.iteration
        )
        instance_id = instance["_id"]
    except Exception as e:
        # Refund credits if DB creation fails
        UserModel._addCredits(email, first_day_cost)
        raise HTTPException(status_code=500, detail=f"Failed to save instance to database: {e}")
    
    # Launch provisioning as Celery task
    from fastapp.tasks import provision_instance_task
    task = provision_instance_task.delay(
        instance_id=instance_id,
        user_id=email,
        provider=req.provider,
        api_key=req.apiKey,
        password=req.password,
        iteration=req.iteration,
    )
    
    InstanceModel._updateTaskMetadata(instance_id, taskId=task.id)
    
    logger.info(f"User {email} queued provisioning for {vm_name} under daily utility billing model.")
    
    return {
        "message": "Provisioning queued",
        "instanceId": instance_id,
        "vmName": vm_name,
        "status": "provisioning_queued",
        "taskId": task.id
    }





@instanceRouter.get("", summary="Get your NemoClaw instance")
async def get_my_instance(auth_payload: dict = Depends(get_current_user)):
    """Get the current user's instances details (sanitized — no keys or tokens)."""
    email = auth_payload.get("email")
    instances = InstanceModel._listByUser(email)
    
    if not instances:
        return {
            "hasInstance": False,
            "instances": [],
            "message": "No active instances. Create one to get started.",
        }
    
    return {
        "hasInstance": True,
        "instances": [InstanceModel._sanitizeForUser(inst) for inst in instances],
    }


# --- Power Controls ---

@instanceRouter.post("/{instance_id}/stop", summary="Stop your NemoClaw instance")
async def stop_my_instance(instance_id: str, auth_payload: dict = Depends(get_current_user)):
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    if instance["status"] not in ["running", "error"]:
        raise HTTPException(status_code=400, detail=f"Instance is {instance['status']}. It must be running or in error status to stop it.")
    
    from fastapp.tasks import stop_instance_task
    InstanceModel._updateStatus(instance_id, "stopping_queued")
    stop_instance_task.delay(instance_id)
    return {"message": "Stop task queued."}


@instanceRouter.post("/{instance_id}/start", summary="Start your NemoClaw instance")
async def start_my_instance(instance_id: str, auth_payload: dict = Depends(get_current_user)):
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    if instance["status"] not in ["stopped", "error"]:
        raise HTTPException(status_code=400, detail=f"Instance is currently {instance['status']}")
    
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    
    last_billed = instance.get("lastBilledAt")
    if last_billed and last_billed.tzinfo is None:
        last_billed = last_billed.replace(tzinfo=timezone.utc)
        
    # Check if the last paid 24h window has already expired
    is_expired = True
    if last_billed:
        duration_since_bill = (now - last_billed).total_seconds()
        if duration_since_bill < 86400: # Within 24-hour paid window
            is_expired = False
            
    if is_expired:
        # Require upfront payment of 1 day to start
        email = auth_payload.get("email")
        owner_email = instance.get("userId", email)
        user = UserModel._getUserByEmail(owner_email)
        mtype = instance.get("machineType", "e2-small")
        cost_multiplier = MACHINE_COST_MULTIPLIER.get(mtype, 100)
        
        if not user or user.get("credits", 0) < cost_multiplier:
            pass  # OSS build: no credit/billing gating (BYOK — bring your own GCP + LLM key)
            
        # Deduct credits
        if not UserModel._deductCredits(owner_email, cost_multiplier):
            raise HTTPException(status_code=400, detail="Failed to deduct credits. Try again later.")
            
        # Record new billing timestamp and billingCycleStart
        from bson import ObjectId
        from fastapp.database import get_db
        get_db()["instances"].update_one(
            {"_id": ObjectId(instance_id)},
            {"$set": {"lastBilledAt": now, "billingCycleStart": now, "updatedDate": now}}
        )
    
    from fastapp.tasks import start_instance_task
    InstanceModel._updateStatus(instance_id, "starting_queued")
    start_instance_task.delay(instance_id)
    return {"message": "Start task queued."}


@instanceRouter.post("/{instance_id}/restart", summary="Restart OpenClaw daemon")
async def restart_openclaw(instance_id: str, auth_payload: dict = Depends(get_current_user)):
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    if instance["status"] not in ["running", "error"]:
        raise HTTPException(status_code=400, detail=f"Instance must be running or in error status to restart daemon")
    
    # Reusing start_instance_task as it handles service restart
    from fastapp.tasks import start_instance_task
    InstanceModel._updateStatus(instance_id, "restarting_queued")
    start_instance_task.delay(instance_id)
    return {"message": "Restart task queued."}




@instanceRouter.post("/{instance_id}/destroy", summary="Destroy your NemoClaw instance")
async def destroy_my_instance(instance_id: str, auth_payload: dict = Depends(get_current_user)):
    instance = await _get_user_instance_by_id(instance_id, auth_payload)

    # Prevent destroying while transitional setup is happening
    if instance["status"] in ["provisioning_queued", "provisioning", "installing", "deleting_queued", "deleting"]:
        raise HTTPException(status_code=400, detail=f"Cannot destroy instance while it is {instance['status']}")

    from fastapp.tasks import delete_instance_task
    # Immediately notify frontend that it's being deleted
    InstanceModel._updateStatus(instance_id, "deleting_queued")
    delete_instance_task.delay(instance_id)
    
    return {"message": "Destroy task queued."}

class ChannelRequest(BaseModel):
    channel: str
    token: str

@instanceRouter.post("/{instance_id}/channel", summary="Configure Messaging Channel")
async def configure_channel(instance_id: str, req: ChannelRequest, background_tasks: BackgroundTasks, auth_payload: dict = Depends(get_current_user)):
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    if instance["status"] != "running":
        raise HTTPException(status_code=400, detail="Instance must be running to configure channels.")
        
    InstanceModel._updateStatus(instance_id, "updating")
    full_instance = InstanceModel._getByIdWithKeys(instance["_id"])
    import asyncio
    
    async def background_configure():
        try:
            if req.channel.lower() == "telegram":
                cmd = f"sudo -i bash -c 'export NEMOCLAW_TELEGRAM_TOKEN=\"{req.token}\"; nemoclaw start'"
            elif req.channel.lower() == "discord":
                cmd = f"sudo -i bash -c 'export NEMOCLAW_DISCORD_TOKEN=\"{req.token}\"; nemoclaw start'"
            else:
                return
                
            await asyncio.to_thread(
                sshService.execute_command,
                full_instance["externalIp"], 
                full_instance["sshKeyPrivate"], 
                cmd
            )
        except Exception as e:
            logger.error(f"Failed to configure channel {req.channel} on {instance['vmName']}: {e}")
        finally:
            InstanceModel._updateStatus(instance_id, "running")

    background_tasks.add_task(background_configure)
    return {"message": f"Configuring {req.channel} integration in the background..."}

class IntegrationRequest(BaseModel):
    provider: str
    token: str

@instanceRouter.post("/{instance_id}/integrations", summary="Configure IDE Integrations (Google/Facebook)")
async def configure_integrations(instance_id: str, req: IntegrationRequest, background_tasks: BackgroundTasks, auth_payload: dict = Depends(get_current_user)):
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    if instance["status"] != "running":
        raise HTTPException(status_code=400, detail="Instance must be running to configure integrations.")
        
    InstanceModel._updateStatus(instance_id, "updating")
    full_instance = InstanceModel._getByIdWithKeys(instance["_id"])
    import asyncio
    
    async def background_configure():
        try:
            if req.provider.lower() == "google":
                cmd = f"sudo -i bash -c 'export GOOGLE_API_KEY=\"{req.token}\"; sed -i \"/GOOGLE_API_KEY/d\" /root/.openclaw/.env; echo \"GOOGLE_API_KEY=\\\"{req.token}\\\"\" >> /root/.openclaw/.env; docker restart openclaw-gateway'"
            elif req.provider.lower() == "facebook":
                cmd = f"sudo -i bash -c 'export FACEBOOK_TOKEN=\"{req.token}\"; sed -i \"/FACEBOOK_TOKEN/d\" /root/.openclaw/.env; echo \"FACEBOOK_TOKEN=\\\"{req.token}\\\"\" >> /root/.openclaw/.env; docker restart openclaw-gateway'"
            else:
                return
                
            await asyncio.to_thread(
                sshService.execute_command,
                full_instance["externalIp"], 
                full_instance["sshKeyPrivate"], 
                cmd
            )
        except Exception as e:
            logger.error(f"Failed to configure integration {req.provider} on {instance['vmName']}: {e}")
        finally:
            InstanceModel._updateStatus(instance_id, "running")

    background_tasks.add_task(background_configure)
    return {"message": f"Configuring {req.provider} integration in the background..."}

# --- File Manager ---

@instanceRouter.get("/{instance_id}/files", summary="List directory contents on your VM")
async def list_files(
    instance_id: str,
    path: str = Query(default=DEFAULT_ROOT, description="Directory path to list"),
    auth_payload: dict = Depends(get_current_user),
):
    """Browse files on your NemoClaw VM."""
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    
    if instance["status"] != "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Instance is {instance['status']}. Files are only accessible when the instance is running.",
        )
    
    # Security: ensure path is within allowed root
    if not path.startswith(DEFAULT_ROOT) and path != "/":
        raise HTTPException(status_code=400, detail="Access denied: path outside allowed directory")
    
    full_instance = InstanceModel._getByIdWithKeys(instance["_id"])
    
    try:
        files = sshService.list_directory(
            full_instance["externalIp"],
            full_instance["sshKeyPrivate"],
            path,
        )
        return {
            "path": path,
            "files": files,
            "parentPath": os.path.dirname(path) if path != DEFAULT_ROOT else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list directory: {e}")


@instanceRouter.get("/{instance_id}/files/download", summary="Download a file from your VM")
async def download_file(
    instance_id: str,
    path: str = Query(..., description="Full path of the file to download"),
    auth_payload: dict = Depends(get_current_user),
):
    """Download a file from your NemoClaw VM."""
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    
    if instance["status"] != "running":
        raise HTTPException(status_code=409, detail="Instance is not running")
    
    if not path.startswith(DEFAULT_ROOT):
        raise HTTPException(status_code=400, detail="Access denied: path outside allowed directory")
    
    full_instance = InstanceModel._getByIdWithKeys(instance["_id"])
    
    try:
        file_data = sshService.download_file(
            full_instance["externalIp"],
            full_instance["sshKeyPrivate"],
            path,
        )
        
        filename = os.path.basename(path)
        return StreamingResponse(
            io.BytesIO(file_data),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download file: {e}")


@instanceRouter.post("/{instance_id}/files/upload", summary="Upload a file to your VM")
async def upload_file(
    instance_id: str,
    path: str = Query(..., description="Target directory on the VM"),
    file: UploadFile = File(...),
    auth_payload: dict = Depends(get_current_user),
):
    """Upload a file to your NemoClaw VM."""
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    
    if instance["status"] != "running":
        raise HTTPException(status_code=409, detail="Instance is not running")
    
    if not path.startswith(DEFAULT_ROOT):
        raise HTTPException(status_code=400, detail="Access denied: path outside allowed directory")
    
    full_instance = InstanceModel._getByIdWithKeys(instance["_id"])
    
    try:
        file_data = await file.read()
        remote_path = f"{path}/{file.filename}".replace("//", "/")
        
        sshService.upload_file(
            full_instance["externalIp"],
            full_instance["sshKeyPrivate"],
            remote_path,
            file_data,
        )
        
        return {
            "message": "File uploaded successfully",
            "path": remote_path,
            "size": len(file_data),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")


@instanceRouter.delete("/{instance_id}/files", summary="Delete a file on your VM")
async def delete_file_endpoint(
    instance_id: str,
    path: str = Query(..., description="Full path of the file to delete"),
    auth_payload: dict = Depends(get_current_user),
):
    """Delete a file from your NemoClaw VM."""
    instance = await _get_user_instance_by_id(instance_id, auth_payload)
    
    if instance["status"] != "running":
        raise HTTPException(status_code=409, detail="Instance is not running")
    
    if not path.startswith(DEFAULT_ROOT):
        raise HTTPException(status_code=400, detail="Access denied: path outside allowed directory")
    
    # Prevent deleting the root
    if path == DEFAULT_ROOT:
        raise HTTPException(status_code=400, detail="Cannot delete root directory")
    
    full_instance = InstanceModel._getByIdWithKeys(instance["_id"])
    
    try:
        sshService.delete_file(
            full_instance["externalIp"],
            full_instance["sshKeyPrivate"],
            path,
        )
        return {"message": "File deleted", "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")
