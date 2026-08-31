import os
import uuid
import logging
import base64
import time
import tempfile
import random
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Literal
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
import requests
from concurrent.futures import ThreadPoolExecutor

from fastapp.controllers.authController import get_current_user
from fastapp.models.userModel import UserModel
from fastapp.database import get_db
from fastapp.utils.fileUtils import upload_base64_to_gcs, generate_download_signed_url_v4
from fastapp.utils.utils import generateHash

logger = logging.getLogger(__name__)

architectureRouter = APIRouter()

# Global isolated background thread pool executor to offload heavy GCS and database workflows completely outside the FastAPI request threads
executor = ThreadPoolExecutor(max_workers=10)

# Static high-fidelity architectural presets as fallback backups
RENDERING_PRESETS = {}

# Load GCS Bucket Name safely from .env config
BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME")  # required — no maintainer default

MODEL_MAPPING = {
    "nano_banana_2_lite": "models/gemini-3.1-flash-lite-image",
    "nano_banana_2": "models/gemini-3.1-flash-image",
    "nano_banana_pro": "models/gemini-3-pro-image",
    "nano_banana": "models/gemini-2.5-flash-image"
}

# ----------------- PYDANTIC REQUEST SCHEMAS -----------------

class ImageRenderRequest(BaseModel):
    spaceType: Literal["architecture", "interior", "planning", "landscape"]
    style: str
    aspectRatio: str
    modelType: Literal["nano_banana_2_lite", "nano_banana_2", "nano_banana_pro", "nano_banana", "models/gemini-3.1-flash-lite-image", "models/gemini-3.1-flash-image", "models/gemini-3-pro-image", "models/gemini-2.5-flash-image"]
    prompt: Optional[str] = ""
    sourcePaths: Optional[List[str]] = None
    imageCount: Optional[int] = 1

class FloorPlanRenderRequest(BaseModel):
    spaceType: Literal["architecture", "interior", "urban", "landscape"]
    style: str
    aspectRatio: str
    modelType: Literal["nano_banana_2_lite", "nano_banana_2", "nano_banana_pro", "nano_banana", "models/gemini-3.1-flash-lite-image", "models/gemini-3.1-flash-image", "models/gemini-3-pro-image", "models/gemini-2.5-flash-image"]
    prompt: Optional[str] = ""
    sourcePaths: Optional[List[str]] = None
    imageCount: Optional[int] = 1

class AiRenovationRequest(BaseModel):
    renovationType: Literal["interior", "exterior", "landscape", "spatial_function"]
    style: str
    aspectRatio: str
    modelType: Literal["nano_banana_2_lite", "nano_banana_2", "nano_banana_pro", "nano_banana", "models/gemini-3.1-flash-lite-image", "models/gemini-3.1-flash-image", "models/gemini-3-pro-image", "models/gemini-2.5-flash-image"]
    prompt: Optional[str] = ""
    sourcePaths: Optional[List[str]] = None
    imageCount: Optional[int] = 1

class ViewSyncRequest(BaseModel):
    syncMode: Literal["single", "batch", "creative"]
    creativeSubMode: Optional[Literal["interior", "exterior"]] = "interior"
    angleId: Optional[str] = "default"
    angleLabel: Optional[str] = "Default View"
    style: str
    aspectRatio: str
    modelType: Literal["nano_banana_2_lite", "nano_banana_2", "nano_banana_pro", "nano_banana", "models/gemini-3.1-flash-lite-image", "models/gemini-3.1-flash-image", "models/gemini-3-pro-image", "models/gemini-2.5-flash-image"]
    prompt: Optional[str] = ""
    sourcePaths: Optional[List[str]] = None
    imageCount: Optional[int] = 1


from fastapp.services.generationService import (
    save_asset_to_gcs,
    download_image_bytes,
    process_and_upload_input_image,
    run_imagen_generation,
    run_gemini_image_editing,
    run_veo_video_generation,
    sign_gcs_url_if_needed,
)


def create_architecture_task_and_process_background(
    task_id: str,
    email: str,
    feature: str,
    spaceType: str,
    style: str,
    aspectRatio: str,
    modelType: str,
    prompt: str,
    raw_source_image_urls: Optional[List[str]],
    imageCount: int,
    credit_cost: int,
    angleId: Optional[str] = None,
    creativeSubMode: Optional[str] = None
):
    """
    Runs asynchronously in another background thread context via FastAPI BackgroundTasks.
    1. Pre-stages/creates the database task record in MongoDB immediately with status PENDING.
    2. Processes and uploads reference images to GCS.
    3. Updates task record with GCS paths.
    4. Triggers the asynchronous Celery worker task.
    """
    db = get_db()
    
    # 1. Create task document in DB
    try:
        render_doc = {
            "_id": task_id,
            "userId": email,
            "feature": feature,
            "spaceType": spaceType,
            "style": style,
            "aspectRatio": aspectRatio,
            "modelType": modelType,
            "prompt": prompt,
            "sourcePaths": None,
            "paths": [],
            "imageCount": imageCount,
            "status": "PENDING",
            "failureReason": None,
            "cost": credit_cost,
            "createdAt": datetime.now(timezone.utc)
        }
        if angleId:
            render_doc["angleId"] = angleId
        if creativeSubMode:
            render_doc["creativeSubMode"] = creativeSubMode
            
        db["architecture_renders"].insert_one(render_doc)
        logger.info(f"[Background Task Creation] Task {task_id} successfully created in DB.")
    except Exception as dbe:
        logger.error(f"[Background Task Creation] Failed to insert task {task_id} in DB: {dbe}")
        # Refund credits and record transaction if DB insertion fails
        UserModel._addCredits(email, credit_cost)
        try:
            db["transactions"].insert_one({
                "userId": email,
                "type": "refund",
                "amount": credit_cost,
                "createdAt": datetime.now(timezone.utc),
                "details": {
                    "action": "failed_db_insert_refund",
                    "taskId": task_id,
                    "feature": feature,
                    "error": str(dbe)
                }
            })
        except Exception:
            pass
        return

    # 2. Process GCS uploads and trigger Celery
    try:
        saved_urls = []
        if raw_source_image_urls:
            for img in raw_source_image_urls:
                if img:
                    gcs_path = process_and_upload_input_image(img, task_id)
                    if gcs_path:
                        saved_urls.append(gcs_path)

        # Update MongoDB with final isolated GCS paths inside sourcePaths
        db["architecture_renders"].update_one(
            {"_id": task_id},
            {
                "$set": {
                    "sourcePaths": saved_urls if saved_urls else None,
                }
            }
        )

        # 3. Trigger async background render task via Celery
        from fastapp.tasks import execute_architecture_task
        execute_architecture_task.delay(task_id)

    except Exception as e:
        logger.error(f"Background upload failed for task {task_id}: {e}")
        # Mark record with failure details first.
        # DO NOT REFUND credits automatically before we finished running the generation flow,
        # unless it is an absolute initial upload/parsing constraint failure.
        db["architecture_renders"].update_one(
            {"_id": task_id},
            {
                "$set": {
                    "status": "FAILED",
                    "failureReason": f"Tải tệp tin lên Cloud Storage thất bại: {str(e)}",
                    "updatedAt": datetime.now(timezone.utc)
                }
            }
        )
        
        # Trigger async background render task via Celery anyway so it goes through the full terminal resolution/refund flow!
        try:
            from fastapp.tasks import execute_architecture_task
            execute_architecture_task.delay(task_id)
        except Exception as celery_err:
            logger.error(f"Failed to dispatch failed task {task_id} to Celery: {celery_err}")
            # Safe ultimate fallback refund if Celery connection is completely broken
            UserModel._addCredits(email, credit_cost)
            try:
                tx_record = {
                    "userId": email,
                    "type": "refund",
                    "amount": credit_cost,
                    "createdAt": datetime.now(timezone.utc),
                    "details": {
                        "action": "failed_celery_dispatch_fallback_refund",
                        "taskId": task_id,
                        "feature": feature,
                        "error": str(celery_err)
                    }
                }
                db["transactions"].insert_one(tx_record)
            except Exception:
                pass


# Helper to invoke Google Imagen 4.0 or Nano Banana models
def run_imagen_generation(model_name: str, compiled_prompt: str, aspect_ratio: str, source_image_url: Optional[str] = None, source_image_urls: Optional[List[str]] = None, task_id: Optional[str] = None) -> Optional[str]:
    mapped_model = MODEL_MAPPING.get(model_name, model_name)
    
    images_to_process = []
    if source_image_urls:
        images_to_process.extend(source_image_urls)
    elif source_image_url:
        images_to_process.append(source_image_url)
        
    try:
        from google import genai
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            client = genai.Client(api_key=api_key)
            
            # If the user selects a Nano Banana model (Gemini-based image model)
            if "gemini" in mapped_model or "nano" in mapped_model:
                # Map standard fast (gemini-3.1-flash-lite-image), detail 1k & sharp 2k (gemini-3.1-flash-image), and 4k uhd (gemini-3-pro-image)
                g3_model = "gemini-3.1-flash-image"
                g3_res = "1K"
                
                if model_name in ["nano_banana_2_lite", "models/gemini-3.1-flash-lite-image", "gemini-3.1-flash-lite-image"]:
                    g3_model = "gemini-3.1-flash-lite-image"
                    g3_res = "1K"
                elif model_name in ["nano_banana_2", "models/gemini-3.1-flash-image", "gemini-3.1-flash-image"]:
                    g3_model = "gemini-3.1-flash-image"
                    g3_res = "1K"
                elif model_name in ["nano_banana_pro", "models/gemini-3-pro-image", "gemini-3-pro-image"]:
                    g3_model = "gemini-3.1-flash-image"
                    g3_res = "2K"
                elif model_name in ["nano_banana", "models/gemini-2.5-flash-image", "gemini-2.5-flash-image"]:
                    g3_model = "gemini-3-pro-image"
                    g3_res = "4K"
                else:
                    lower_name = model_name.lower()
                    if "lite" in lower_name:
                        g3_model = "gemini-3.1-flash-lite-image"
                        g3_res = "1K"
                    elif "pro" in lower_name:
                        g3_model = "gemini-3-pro-image"
                        g3_res = "4K"
                    elif "2k" in lower_name:
                        g3_model = "gemini-3.1-flash-image"
                        g3_res = "2K"
                    elif "4k" in lower_name:
                        g3_model = "gemini-3-pro-image"
                        g3_res = "4K"
                    elif "2.5" in lower_name:
                        g3_model = "gemini-3-pro-image"
                        g3_res = "4K"
                
                logger.info(f"Gemini 3 Image Generation confirmed: model={g3_model}, resolution={g3_res} mapped from model_name={model_name}")
                
                input_items = [
                    {
                        "type": "text",
                        "text": compiled_prompt
                    }
                ]
                
                # Fetch, decode and inject up to 5 reference/source images to support multimodal generation
                for idx, img_url in enumerate(images_to_process[:5]):
                    if img_url:
                        try:
                            img_content = download_image_bytes(img_url)
                            mime = "image/jpeg"
                            if img_url.endswith(".png") or "png" in img_url.lower():
                                mime = "image/png"
                            
                            encoded_b64 = base64.b64encode(img_content).decode('utf-8')
                            input_items.append({
                                "type": "image",
                                "data": encoded_b64,
                                "mime_type": mime
                            })
                        except Exception as fe:
                            logger.warning(f"Failed to fetch multimodal source image {idx}: {fe}")
                
                # Call client.interactions.create with mapped model and resolution
                interaction = client.interactions.create(
                    model=g3_model,
                    input=input_items,
                    response_format={
                        "type": "image",
                        "mime_type": "image/jpeg",
                        "aspect_ratio": aspect_ratio,
                        "image_size": g3_res
                    }
                )
                
                img_bytes = None
                if interaction:
                    if hasattr(interaction, "output_image") and interaction.output_image:
                        if hasattr(interaction.output_image, "data") and interaction.output_image.data:
                            data_val = interaction.output_image.data
                            if isinstance(data_val, str):
                                img_bytes = base64.b64decode(data_val)
                            else:
                                img_bytes = data_val
                    
                    # Fallback parsing
                    if not img_bytes and hasattr(interaction, "output_text") and interaction.output_text:
                        try:
                            img_bytes = base64.b64decode(interaction.output_text)
                        except Exception:
                            pass
                
                if img_bytes:
                    encoded_b64 = base64.b64encode(img_bytes).decode('utf-8')
                    gcs_path = save_asset_to_gcs(encoded_b64, folder_type="outputs", content_type="image/jpeg", task_id=task_id)
                    if gcs_path:
                        return gcs_path
                    return f"data:image/jpeg;base64,{encoded_b64}"
            else:
                # Standard Imagen model generation pipeline
                response = client.models.generate_images(
                    model=mapped_model,
                    prompt=compiled_prompt,
                    config=dict(
                        number_of_images=1,
                        aspect_ratio=aspect_ratio,
                        output_mime_type="image/jpeg"
                    )
                )
                if response and response.generated_images:
                    img_bytes = response.generated_images[0].image.image_bytes
                    encoded_b64 = base64.b64encode(img_bytes).decode('utf-8')
                    gcs_path = save_asset_to_gcs(encoded_b64, folder_type="outputs", content_type="image/jpeg", task_id=task_id)
                    if gcs_path:
                        return gcs_path
                    return f"data:image/jpeg;base64,{encoded_b64}"
    except Exception as e:
        logger.error(f"Image generation execution failed on model {model_name}: {e}")
    return None


# Helper to invoke Gemini multimodal image editing
def run_gemini_image_editing(prompt_text: str, source_url: str) -> Optional[str]:
    try:
        from google import genai
        from google.genai import types
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key and source_url:
            res_img = requests.get(source_url, timeout=10)
            if res_img.status_code == 200:
                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model="gemini-2.0-flash-preview-image-generation",
                    contents=[
                        {
                            "role": "user",
                            "parts": [
                                {"text": prompt_text},
                                {
                                    "inline_data": {
                                        "mime_type": "image/jpeg",
                                        "data": res_img.content,
                                    }
                                },
                            ],
                        },
                    ],
                    config=types.GenerateContentConfig(
                        response_modalities=["TEXT", "IMAGE"],
                    ),
                )
                for part in response.candidates[0].content.parts:
                    if part.inline_data:
                        encoded_b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                        gcs_path = save_asset_to_gcs(encoded_b64, folder_type="outputs", content_type="image/jpeg")
                        if gcs_path:
                            return gcs_path
                        return f"data:image/jpeg;base64,{encoded_b64}"
    except Exception as e:
        logger.error(f"Gemini image editing failed: {e}")
    return None


# Helper to invoke Gemini Omni model (gemini-omni-flash-preview) or fallback to Veo
def run_veo_video_generation(model_type: str, prompt_text: str, source_url: str) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return None
        
    mapped_model = MODEL_MAPPING.get(model_type, model_type)
    # --- Try Gemini Omni Video generation first ---
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        
        # Build multi-modal inputs list natively (Omitting image if none provided)
        inputs_list = []
        temp_img_path = None
        uploaded_image = None
        
        if source_url:
            img_bytes = download_image_bytes(source_url)
            if img_bytes:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as temp_img:
                    temp_img.write(img_bytes)
                    temp_img_path = temp_img.name
                
                # Upload using Files API
                uploaded_image = client.files.upload(
                    file=temp_img_path,
                    config={'display_name': f"omni_{uuid.uuid4().hex[:8]}.png"}
                )
                inputs_list.append({"type": "image", "uri": uploaded_image.uri})
        
        inputs_list.append({"type": "text", "text": prompt_text})
        
        # Create Interaction using the Omni model
        interaction = client.interactions.create(
            model='gemini-omni-flash-preview',
            input=inputs_list,
            response_format={
                "type": "video",
                "aspect_ratio": "16:9",
                "duration": "5s",
                "delivery": "uri"
            }
        )
        
        # Extract generated video URI
        video_uri = None
        if hasattr(interaction, "output_video") and interaction.output_video:
            video_uri = interaction.output_video.uri
        elif hasattr(interaction, "steps"):
            for step in interaction.steps:
                if hasattr(step, "model_generated") and step.model_generated and hasattr(step.model_generated, "output_video") and step.model_generated.output_video:
                    video_uri = step.model_generated.output_video.uri
                    break
        
        if video_uri:
            # Download video with authorized headers
            headers = {"x-goog-api-key": api_key}
            video_res = requests.get(video_uri, headers=headers, timeout=120)
            if video_res.status_code == 200:
                encoded_b64 = base64.b64encode(video_res.content).decode('utf-8')
                
                # Clean up local and cloud temp files
                try:
                    if temp_img_path:
                        os.remove(temp_img_path)
                    if uploaded_image:
                        client.files.delete(name=uploaded_image.name)
                except Exception:
                    pass
                
                # Save directly into GCS bucket
                return save_asset_to_gcs(encoded_b64, folder_type="outputs", content_type="video/mp4")
    except Exception as e:
        logger.warning(f"Gemini Omni video generation failed: {e}. Cascading to Veo...")

    # --- Path B: Fallback to Google Veo ---
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)
        veo_model = "veo-3.1-fast-generate-preview" if mapped_model in ["models/gemini-2.5-flash-image", "nano_banana"] else "veo-3.1-generate-preview"
        
        img_payload = None
        if source_url:
            img_content = download_image_bytes(source_url)
            mime = "image/jpeg"
            if source_url.endswith(".png") or "png" in source_url.lower():
                mime = "image/png"
            img_payload = types.Image(image_bytes=img_content, mime_type=mime)
        
        operation = client.models.generate_videos(
            model=veo_model,
            prompt=prompt_text,
            image=img_payload,
            config=types.GenerateVideosConfig(
                number_of_videos=1,
                aspect_ratio="16:9"
            )
        )
        
        poll_start = time.time()
        while not operation.done and (time.time() - poll_start) < 25:
            time.sleep(3)
            operation = client.operations.get(operation)
        
        if operation.done and operation.response and operation.response.generated_videos:
            video_bytes = None
            try:
                gen_vid = operation.response.generated_videos[0]
                if hasattr(gen_vid, "video") and gen_vid.video:
                    if hasattr(gen_vid.video, "video_bytes") and gen_vid.video.video_bytes:
                        video_bytes = gen_vid.video.video_bytes
                    elif hasattr(gen_vid.video, "data") and gen_vid.video.data:
                        video_bytes = gen_vid.video.data
                elif hasattr(gen_vid, "video_bytes") and gen_vid.video_bytes:
                    video_bytes = gen_vid.video_bytes
            except Exception as parse_err:
                logger.warning(f"Failed parsing Veo video bytes: {parse_err}")

            if video_bytes:
                encoded_b64 = base64.b64encode(video_bytes).decode('utf-8')
                return save_asset_to_gcs(encoded_b64, folder_type="outputs", content_type="video/mp4")
            
            return None
    except Exception as e:
        logger.error(f"Veo Video Generation failed: {e}")
    return None


# Helper to sign file paths on fetch
def sign_gcs_url_if_needed(path_or_url: str) -> str:
    if path_or_url and path_or_url.startswith("bihand/"):
        signed = generate_download_signed_url_v4(BUCKET_NAME, path_or_url, expiration_time=3600 * 24 * 7)
        if signed:
            return signed
    return path_or_url


# ----------------- COMMON CREDITS ENDPOINTS -----------------

@architectureRouter.get("/credits", summary="Get user central credit balance")
def get_arch_credits(current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    user_doc = UserModel._getUserByEmail(email)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return {"credits": user_doc.get("credits", 0)}

@architectureRouter.get("/history", summary="Get user rendering history")
def get_arch_history(limit: int = 5, skip: int = 0, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    db = get_db()
    renders = list(db["architecture_renders"].find({"userId": email}).sort("createdAt", -1).skip(skip).limit(limit))
    for r in renders:
        r["_id"] = str(r["_id"])
    return {"renders": renders}

@architectureRouter.get("/tasks/{task_id}", summary="Get specific architecture render task status")
def get_architecture_task_status(task_id: str, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    db = get_db()
    task = db["architecture_renders"].find_one({"_id": task_id, "userId": email})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    task["_id"] = str(task["_id"])
    return task

@architectureRouter.get("/signed-url", summary="Generate a time-limited signed URL for a specific GCS path linked to an authorized task")
def get_signed_url_endpoint(taskId: str, path: str, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    if not taskId or not path:
        raise HTTPException(status_code=400, detail="Both taskId and path parameters are required")
        
    db = get_db()
    task = db["architecture_renders"].find_one({"_id": taskId})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task.get("userId") != email:
        raise HTTPException(status_code=403, detail="Unauthorized access to this task assets")

    # Secure verification: Ensure the requested GCS path is associated with this task
    valid_paths = [task.get("sourcePath")]
    if task.get("sourcePaths"):
        valid_urls = task.get("sourcePaths")
        if isinstance(valid_urls, list):
            valid_paths.extend(valid_urls)
    if task.get("paths"):
        out_paths = task.get("paths")
        if isinstance(out_paths, list):
            for p in out_paths:
                if isinstance(p, dict) and p.get("path"):
                    valid_paths.append(p.get("path"))
                elif isinstance(p, str):
                    valid_paths.append(p)
            
    # Normalize valid paths and remove None elements
    valid_paths = [p for p in valid_paths if p]
    
    if path not in valid_paths:
        raise HTTPException(status_code=403, detail="Requested file does not belong to this task")

    # Safeguard to prevent directory traversal outside bihand/ namespace
    if not path.startswith("bihand/"):
        raise HTTPException(status_code=403, detail="Access denied to requested directory")
    
    signed = generate_download_signed_url_v4(BUCKET_NAME, path, expiration_time=3600 * 24)
    if not signed:
        raise HTTPException(status_code=500, detail="Failed to generate signed URL")
    return {"url": signed}


# Helper to estimate dynamic cost for Nano Banana family models
def estimate_model_cost(model_type: str, image_count: int = 1) -> int:
    base_cost = 14
    if model_type == "models/gemini-3.1-flash-lite-image":
        base_cost = 7
    elif model_type == "models/gemini-3.1-flash-image":
        base_cost = 14
    elif model_type == "models/gemini-3-pro-image":
        base_cost = 20
    elif model_type == "models/gemini-2.5-flash-image":
        base_cost = 48
    
    # Calculate cumulative cost linearly depending on the chosen number of images
    return base_cost * max(1, image_count)

# ----------------- DEDICATED FEATURE ENDPOINTS -----------------

@architectureRouter.post("/image-render", summary="1. Image Render Service")
def execute_image_render(req: ImageRenderRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    credit_cost = estimate_model_cost(req.modelType, req.imageCount or 1)
    
    if req.sourcePaths and len(req.sourcePaths) > 5:
        raise HTTPException(status_code=400, detail="Tải lên tối đa 5 hình ảnh phác thảo.")
        
    deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-arch-studio", "feature": "image-render", **req.dict()})
    if not deducted:
        pass  # OSS build: no credit/billing gating (BYOK — bring your own GCP + LLM key)

    task_id = generateHash()
    
    # Use FastAPI BackgroundTasks to submit the execution safely to the isolated thread pool executor.
    # This prevents the threadpool submission itself from blocking the main request worker thread.
    background_tasks.add_task(
        executor.submit,
        create_architecture_task_and_process_background,
        task_id,
        email,
        "image-render",
        req.spaceType,
        req.style,
        req.aspectRatio,
        req.modelType,
        req.prompt or "",
        req.sourcePaths,
        req.imageCount or 1,
        credit_cost
    )
    
    return {"success": True, "taskId": task_id, "status": "PENDING", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}


@architectureRouter.post("/floorplan-render", summary="2. Floor Plan Render Service")
def execute_floorplan_render(req: FloorPlanRenderRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    credit_cost = estimate_model_cost(req.modelType, req.imageCount or 1)
    
    if req.sourcePaths and len(req.sourcePaths) > 5:
        raise HTTPException(status_code=400, detail="Tải lên tối đa 5 hình ảnh phác thảo.")
        
    deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-arch-studio", "feature": "floorplan-render", **req.dict()})
    if not deducted:
        pass  # OSS build: no credit/billing gating (BYOK — bring your own GCP + LLM key)

    task_id = generateHash()
    
    # Use FastAPI BackgroundTasks to submit the execution safely to the isolated thread pool executor.
    # This prevents the threadpool submission itself from blocking the main request worker thread.
    background_tasks.add_task(
        executor.submit,
        create_architecture_task_and_process_background,
        task_id,
        email,
        "floorplan-render",
        req.spaceType,
        req.style,
        req.aspectRatio,
        req.modelType,
        req.prompt or "",
        req.sourcePaths,
        req.imageCount or 1,
        credit_cost
    )
    
    return {"success": True, "taskId": task_id, "status": "PENDING", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}


@architectureRouter.post("/ai-renovation", summary="3. AI Renovation Service")
def execute_ai_renovation(req: AiRenovationRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    credit_cost = estimate_model_cost(req.modelType, req.imageCount or 1)
    
    if req.sourcePaths and len(req.sourcePaths) > 5:
        raise HTTPException(status_code=400, detail="Tải lên tối đa 5 hình ảnh phác thảo.")
        
    deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-arch-studio", "feature": "ai-renovation", **req.dict()})
    if not deducted:
        pass  # OSS build: no credit/billing gating (BYOK — bring your own GCP + LLM key)

    task_id = generateHash()
    
    # Use FastAPI BackgroundTasks to submit the execution safely to the isolated thread pool executor.
    # This prevents the threadpool submission itself from blocking the main request worker thread.
    background_tasks.add_task(
        executor.submit,
        create_architecture_task_and_process_background,
        task_id,
        email,
        "ai-renovation",
        req.renovationType,
        req.style,
        req.aspectRatio,
        req.modelType,
        req.prompt or "",
        req.sourcePaths,
        req.imageCount or 1,
        credit_cost
    )
    
    return {"success": True, "taskId": task_id, "status": "PENDING", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}


@architectureRouter.post("/view-sync", summary="4. View Sync / Camera Sync Service")
def execute_view_sync(req: ViewSyncRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    credit_cost = estimate_model_cost(req.modelType, req.imageCount or 1)
    
    if req.sourcePaths and len(req.sourcePaths) > 5:
        raise HTTPException(status_code=400, detail="Tải lên tối đa 5 hình ảnh phác thảo.")
        
    deducted = UserModel._deductCredits(email, credit_cost, {"app": "sant-arch-studio", "feature": "view-sync", **req.dict()})
    if not deducted:
        pass  # OSS build: no credit/billing gating (BYOK — bring your own GCP + LLM key)

    task_id = generateHash()
    
    # Use FastAPI BackgroundTasks to submit the execution safely to the isolated thread pool executor.
    # This prevents the threadpool submission itself from blocking the main request worker thread.
    background_tasks.add_task(
        executor.submit,
        create_architecture_task_and_process_background,
        task_id,
        email,
        "view-sync",
        req.syncMode,
        req.style,
        req.aspectRatio,
        req.modelType,
        req.prompt or "",
        req.sourcePaths,
        req.imageCount or 1,
        credit_cost,
        req.angleId,
        req.creativeSubMode
    )
    
    return {"success": True, "taskId": task_id, "status": "PENDING", "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}
