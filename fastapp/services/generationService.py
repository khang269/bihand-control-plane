import os
import uuid
import logging
import base64
import time
import tempfile
import requests
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Literal

from fastapp.utils.fileUtils import upload_base64_to_gcs, generate_download_signed_url_v4

logger = logging.getLogger(__name__)

BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "graphicsminer-global-object-bucket")

MODEL_MAPPING = {
    "nano_banana_2_lite": "models/gemini-3.1-flash-lite-image",
    "nano_banana_2": "models/gemini-3.1-flash-image",
    "nano_banana_pro": "models/gemini-3-pro-image",
    "nano_banana": "models/gemini-2.5-flash-image"
}

def save_asset_to_gcs(base64_data: str, folder_type: str = "outputs", content_type: str = "image/jpeg", task_id: Optional[str] = None) -> Optional[str]:
    try:
        clean_b64 = base64_data.split(",")[-1]
        ext = "mp4" if "video" in content_type else "jpg"
        sub_folder = "inputs" if folder_type == "inputs" else "outputs"
        if task_id:
            file_name = f"bihand/{sub_folder}/{task_id}/{uuid.uuid4()}.{ext}"
        else:
            file_name = f"bihand/{sub_folder}/{uuid.uuid4()}.{ext}"
        
        upload_base64_to_gcs(
            bucket_name=BUCKET_NAME,
            base64_string=clean_b64,
            destination_blob_name=file_name,
            content_type=content_type
        )
        return file_name
    except Exception as e:
        logger.error(f"Failed to upload asset to GCS: {e}")
    return None

def download_image_bytes(path_or_url: str) -> bytes:
    if not path_or_url:
        return b""
    if path_or_url.startswith("data:"):
        header, encoded = path_or_url.split(",", 1)
        return base64.b64decode(encoded)
    elif path_or_url.startswith("bihand/"):
        from google.cloud import storage
        storage_client = storage.Client()
        bucket = storage_client.bucket(BUCKET_NAME)
        blob = bucket.blob(path_or_url)
        return blob.download_as_bytes()
    else:
        res = requests.get(path_or_url, timeout=15)
        res.raise_for_status()
        return res.content

def process_and_upload_input_image(img_data_or_url: str, task_id: str) -> str:
    if not img_data_or_url:
        return ""
    if img_data_or_url.startswith("data:"):
        try:
            header, encoded = img_data_or_url.split(",", 1)
            content_type = "image/jpeg"
            if "png" in header.lower():
                content_type = "image/png"
            elif "webp" in header.lower():
                content_type = "image/webp"
                
            img_bytes = base64.b64decode(encoded)
            if len(img_bytes) > 10 * 1024 * 1024:
                raise ValueError("Mỗi hình ảnh phác thảo không được vượt quá 10MB.")
                
            ext = "png" if "png" in content_type else "jpg"
            file_name = f"bihand/inputs/{task_id}/{uuid.uuid4()}.{ext}"
            
            upload_base64_to_gcs(
                bucket_name=BUCKET_NAME,
                base64_string=encoded,
                destination_blob_name=file_name,
                content_type=content_type
            )
            return file_name
        except Exception as e:
            logger.error(f"Failed to upload base64 input image: {e}")
            raise e
    else:
        return img_data_or_url

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
            if "gemini" in mapped_model or "nano" in mapped_model:
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
                
                input_items = [{"type": "text", "text": compiled_prompt}]
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

def run_veo_video_generation(model_type: str, prompt_text: str, source_url: str) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return None
        
    mapped_model = MODEL_MAPPING.get(model_type, model_type)
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        
        inputs_list = []
        temp_img_path = None
        uploaded_image = None
        
        if source_url:
            img_bytes = download_image_bytes(source_url)
            if img_bytes:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as temp_img:
                    temp_img.write(img_bytes)
                    temp_img_path = temp_img.name
                
                uploaded_image = client.files.upload(
                    file=temp_img_path,
                    config={'display_name': f"omni_{uuid.uuid4().hex[:8]}.png"}
                )
                inputs_list.append({"type": "image", "uri": uploaded_image.uri})
        
        inputs_list.append({"type": "text", "text": prompt_text})
        
        interaction = client.interactions.create(
            model='gemini-omni-flash-preview',
            input=inputs_list,
            response_format={
                "type": "video",
                "aspect_ratio": "16:9",
                "delivery": "uri"
            }
        )
        
        video_uri = None
        if hasattr(interaction, "output_video") and interaction.output_video:
            video_uri = interaction.output_video.uri
        elif hasattr(interaction, "steps"):
            for step in interaction.steps:
                if hasattr(step, "model_generated") and step.model_generated and hasattr(step.model_generated, "output_video") and step.model_generated.output_video:
                    video_uri = step.model_generated.output_video.uri
                    break
        
        if video_uri:
            headers = {"x-goog-api-key": api_key}
            video_res = requests.get(video_uri, headers=headers, timeout=400)
            if video_res.status_code == 200:
                encoded_b64 = base64.b64encode(video_res.content).decode('utf-8')
                
                try:
                    if temp_img_path:
                        os.remove(temp_img_path)
                    if uploaded_image:
                        client.files.delete(name=uploaded_image.name)
                except Exception:
                    pass
                
                return save_asset_to_gcs(encoded_b64, folder_type="outputs", content_type="video/mp4")
    except Exception as e:
        logger.warning(f"Gemini Omni video generation failed: {e}. Cascading to Veo...")

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
        while not operation.done and (time.time() - poll_start) < 400:
            time.sleep(12)
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

def sign_gcs_url_if_needed(path_or_url: str) -> str:
    if path_or_url and path_or_url.startswith("bihand/"):
        signed = generate_download_signed_url_v4(BUCKET_NAME, path_or_url, expiration_time=3600 * 24 * 7)
        if signed:
            return signed
    return path_or_url
