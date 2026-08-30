import os
import uuid
import logging
import base64
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Literal
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from concurrent.futures import ThreadPoolExecutor

from fastapp.controllers.authController import get_current_user
from fastapp.models.userModel import UserModel
from fastapp.database import get_db
from fastapp.utils.fileUtils import upload_base64_to_gcs, generate_download_signed_url_v4
from fastapp.utils.utils import generateHash

logger = logging.getLogger(__name__)

filmStudioRouter = APIRouter()

# Global isolated background thread pool executor for high-performance Film Studio background processing
executor = ThreadPoolExecutor(max_workers=10)

BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "graphicsminer-global-object-bucket")

# ----------------- PYDANTIC REQUEST SCHEMAS -----------------

class FilmStudioRequest(BaseModel):
    feature: Literal["comic", "vlog", "manim", "image", "sound"]
    prompt: str = Field(..., description="Prompt or story idea")
    style: Optional[str] = "default"
    aspectRatio: Optional[str] = "16:9"
    modelType: Optional[str] = "models/gemini-3.1-flash-image"
    imageCount: Optional[int] = 1
    voiceName: Optional[str] = "Kore"
    locale: Optional[str] = "vi-VN"
    sourcePaths: Optional[List[str]] = None
    numSections: Optional[int] = 1  # Custom panel/scene count for comic storyboard and cinematic vlogs

# Helper to estimate Film Studio credits costs
def estimate_film_cost(feature: str, model_type: str, image_count: int = 1, num_sections: int = 4) -> int:
    from fastapp.controllers.architectureController import estimate_model_cost
    base_img_cost = estimate_model_cost(model_type, 1)
    
    if feature == "comic":
        return (num_sections * base_img_cost) + int(num_sections * 1.25)
    elif feature == "vlog":
        return num_sections * 2 * base_img_cost
    elif feature == "manim":
        return base_img_cost + 5
    elif feature == "image":
        return base_img_cost * max(1, image_count)
    elif feature == "sound":
        return 10
    return 15

# Helper to sign file paths on fetch
def sign_film_asset_path(path: str, task_id: str) -> str:
    if path and path.startswith("bihand/"):
        return generate_download_signed_url_v4(BUCKET_NAME, path, expiration_time=3600 * 24 * 7)
    return path


def sign_render_document(r: dict) -> dict:
    if not r:
        return r
    if r.get("outputUrl"):
        r["outputSignedUrl"] = sign_film_asset_path(r["outputUrl"], r["_id"])
    else:
        r["outputSignedUrl"] = None

    if r.get("comicSections"):
        for sec in r["comicSections"]:
            if sec.get("image"):
                sec["imageSignedUrl"] = sign_film_asset_path(sec["image"], r["_id"])
            else:
                sec["imageSignedUrl"] = None
                
            if sec.get("audio"):
                sec["audioSignedUrl"] = sign_film_asset_path(sec["audio"], r["_id"])
            else:
                sec["audioSignedUrl"] = None
    return r


@filmStudioRouter.get("/credits", summary="Get user Film Studio credits")
def get_film_studio_credits(current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    user_doc = UserModel._getUserByEmail(email)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return {"credits": user_doc.get("credits", 0)}


@filmStudioRouter.get("/history", summary="Get user Film Studio rendering history")
def get_film_studio_history(limit: int = 30, skip: int = 0, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    db = get_db()
    renders = list(db["film_studio_renders"].find({"userId": email}).sort("createdAt", -1).skip(skip).limit(limit))
    for r in renders:
        r["_id"] = str(r["_id"])
        sign_render_document(r)
    return {"renders": renders}


@filmStudioRouter.get("/tasks/{task_id}", summary="Get specific Film Studio task status")
def get_film_studio_task_status(task_id: str, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    db = get_db()
    task = db["film_studio_renders"].find_one({"_id": task_id, "userId": email})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task["_id"] = str(task["_id"])
    sign_render_document(task)
    return task


@filmStudioRouter.get("/signed-url", summary="Generate a time-limited signed URL for a specific Film Studio GCS asset")
def get_film_studio_signed_url(taskId: str, path: str, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    if not taskId or not path:
        raise HTTPException(status_code=400, detail="Both taskId and path parameters are required")
        
    db = get_db()
    
    # Secure ownership check: extract true task ID from bihand GCS folder structure
    parts = path.split("/")
    if len(parts) >= 4 and parts[0] == "bihand" and parts[1] in ["inputs", "outputs"]:
        target_task_id = parts[2]
    else:
        target_task_id = taskId

    task = db["film_studio_renders"].find_one({"_id": target_task_id})
    if not task:
        task = db["film_studio_renders"].find_one({"_id": taskId})
        
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task.get("userId") != email:
        raise HTTPException(status_code=403, detail="Unauthorized access to this task assets")

    # Secure verification
    valid_paths = []
    if task.get("outputUrl"):
        valid_paths.append(task.get("outputUrl"))
    if task.get("sourcePaths"):
        valid_paths.extend(task.get("sourcePaths"))
    if task.get("comicSections"):
        for section in task.get("comicSections"):
            if section.get("image"):
                valid_paths.append(section.get("image"))
            if section.get("audio"):
                valid_paths.append(section.get("audio"))
            
    valid_paths = [p for p in valid_paths if p]
    
    if path not in valid_paths:
        raise HTTPException(status_code=403, detail="Requested file does not belong to this Film Studio task")

    if not path.startswith("bihand/"):
        raise HTTPException(status_code=403, detail="Access denied to requested directory")
    
    signed = generate_download_signed_url_v4(BUCKET_NAME, path, expiration_time=3600 * 24)
    if not signed:
        raise HTTPException(status_code=500, detail="Failed to generate signed GCS URL")
    return {"url": signed}


@filmStudioRouter.post("/generate", summary="Dispatch unified Film Studio task")
def dispatch_film_studio_generation(req: FilmStudioRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    credit_cost = estimate_film_cost(
        req.feature, 
        req.modelType or "models/gemini-3.1-flash-image", 
        req.imageCount or 1,
        req.numSections or 1
    )
    
    deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-film-studio", "feature": req.feature, **req.dict()})
    if not deducted:
        raise HTTPException(status_code=402, detail="Insufficient credits.")

    task_id = generateHash()
    
    background_tasks.add_task(
        executor.submit,
        create_film_studio_task_and_process_background,
        task_id,
        email,
        req,
        credit_cost
    )
    
    return {"success": True, "taskId": task_id, "status": "PENDING", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}


def create_film_studio_task_and_process_background(task_id: str, email: str, req: FilmStudioRequest, credit_cost: int):
    db = get_db()
    
    try:
        render_doc = {
            "_id": task_id,
            "userId": email,
            "feature": req.feature,
            "prompt": req.prompt,
            "style": req.style,
            "aspectRatio": req.aspectRatio,
            "modelType": req.modelType,
            "voiceName": req.voiceName,
            "locale": req.locale,
            "numSections": req.numSections or 1,
            "sourcePaths": None,
            "outputUrl": None,
            "comicSections": [],
            "status": "PENDING",
            "failureReason": None,
            "cost": credit_cost,
            "createdAt": datetime.now(timezone.utc)
        }
        db["film_studio_renders"].insert_one(render_doc)
        logger.info(f"[Film Studio Background] Task {task_id} successfully created in DB.")
    except Exception as dbe:
        logger.error(f"[Film Studio Background] Failed to insert task {task_id} in DB: {dbe}")
        UserModel._addCredits(email, credit_cost)
        try:
            db["transactions"].insert_one({
                "userId": email, "type": "refund", "amount": credit_cost, "createdAt": datetime.now(timezone.utc),
                "details": {"action": "failed_film_studio_db_insert", "taskId": task_id, "feature": req.feature, "error": str(dbe)}
            })
        except Exception:
            pass
        return

    # Process and upload input reference paths if any
    try:
        saved_urls = []
        if req.sourcePaths:
            from fastapp.controllers.architectureController import process_and_upload_input_image
            for img in req.sourcePaths:
                if img:
                    gcs_path = process_and_upload_input_image(img, task_id)
                    if gcs_path:
                        saved_urls.append(gcs_path)

        db["film_studio_renders"].update_one(
            {"_id": task_id},
            {"$set": {"sourcePaths": saved_urls if saved_urls else None}}
        )

        from fastapp.tasks import execute_film_studio_task
        execute_film_studio_task.delay(task_id)

    except Exception as e:
        logger.error(f"GCS uploads failed for Film Studio task {task_id}: {e}")
        db["film_studio_renders"].update_one(
            {"_id": task_id},
            {"$set": {"status": "FAILED", "failureReason": f"Tải tệp tin lên Cloud Storage thất bại: {str(e)}", "updatedAt": datetime.now(timezone.utc)}}
        )
        try:
            from fastapp.tasks import execute_film_studio_task
            execute_film_studio_task.delay(task_id)
        except Exception as celery_err:
            logger.error(f"Failed to dispatch failed task {task_id} to Celery: {celery_err}")
            UserModel._addCredits(email, credit_cost)


class BlockRegenerateInput(BaseModel):
    caption: str
    imagePrompt: str

@filmStudioRouter.post("/tasks/{task_id}/blocks/{page_id}/regenerate", summary="Regenerate a single storyboard block")
def regenerate_film_studio_block(task_id: str, page_id: str, req: BlockRegenerateInput, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    db = get_db()
    
    task = db["film_studio_renders"].find_one({"_id": task_id, "userId": email})
    if not task:
        from fastapp.controllers.architectureController import estimate_model_cost
        base_img_cost = estimate_model_cost("models/gemini-3.1-flash-image", 1)
        credit_cost = base_img_cost + 1
        
        deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-film-studio", "feature": "regenerate-block", "taskId": task_id, "pageId": page_id})
        if not deducted:
            raise HTTPException(status_code=402, detail="Insufficient credits.")
            
        render_doc = {
            "_id": task_id,
            "userId": email,
            "feature": "comic",
            "prompt": req.imagePrompt,
            "style": "digital_painting",
            "aspectRatio": "16:9",
            "modelType": "models/gemini-3.1-flash-image",
            "voiceName": "Kore",
            "locale": "vi-VN",
            "numSections": 1,
            "sourcePaths": None,
            "outputUrl": None,
            "comicSections": [{
                "pageId": page_id,
                "sectionNumber": 1,
                "caption": req.caption,
                "imagePrompt": req.imagePrompt,
                "image": None,
                "audio": None
            }],
            "status": "PROCESSING",
            "failureReason": None,
            "cost": credit_cost,
            "createdAt": datetime.now(timezone.utc)
        }
        db["film_studio_renders"].insert_one(render_doc)
        
        from fastapp.tasks import execute_film_studio_block_regenerate_task
        execute_film_studio_block_regenerate_task.delay(task_id, page_id)
        return {"success": True, "message": "Block regeneration started asynchronously.", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}

    from fastapp.controllers.architectureController import estimate_model_cost
    base_img_cost = estimate_model_cost(task.get("modelType", "models/gemini-3.1-flash-image"), 1)
    credit_cost = base_img_cost + 1

    deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-film-studio", "feature": "regenerate-block", "taskId": task_id, "pageId": page_id})
    if not deducted:
        raise HTTPException(status_code=402, detail="Insufficient credits.")

    sections = task.get("comicSections", []) or []
    for sec in sections:
        if sec.get("pageId") == page_id:
            sec["caption"] = req.caption
            sec["imagePrompt"] = req.imagePrompt

    db["film_studio_renders"].update_one(
        {"_id": task_id},
        {"$set": {"comicSections": sections}}
    )

    from fastapp.tasks import execute_film_studio_block_regenerate_task
    execute_film_studio_block_regenerate_task.delay(task_id, page_id)

    return {"success": True, "message": "Block regeneration started asynchronously.", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}
