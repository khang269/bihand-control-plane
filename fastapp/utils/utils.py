import hashlib
import time
import uuid
import os
import re
import logging
import requests
import jwt
import math

from typing import List, Dict, Union
from datetime import timedelta
from PIL import Image
from io import BytesIO
import mimetypes

import base64
from google.cloud import storage

from google import genai
from google.genai import types

from dotenv import load_dotenv

load_dotenv(override=True)
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY")

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def generateHash():
    """
    Generates a random MD5 hash based on current nanosecond time and a UUID.

    Returns:
        str: An MD5 hash string.
    """
    timestamp_ns = time.time_ns()
    random_string = str(uuid.uuid4())
    hash_string = f"{timestamp_ns}-{random_string}".encode('utf-8')
    return hashlib.md5(hash_string).hexdigest()

def get_localized_value(data_dict: Dict, lang="en-US", default=""):
    """Safely retrieves a localized value from the persona data."""
    if isinstance(data_dict, dict):
        if lang in data_dict:
            return str(data_dict[lang])
        elif "en-US" in data_dict:
            return str(data_dict["en-US"])
        elif data_dict:
            return str(next(iter(data_dict.values())))
        else:
            return default
    return default

def get_localized_value_with_key(data_dict: Dict, key: str, lang="en-US", default=""):
    """Safely retrieves a localized value from the persona data."""
    if isinstance(data_dict, dict):
        value = data_dict.get(key, {})
        return get_localized_value(value, lang, default)
    return default

def get_localized_list(data_list, lang="en-US"):
    """Safely retrieves a list of localized values."""
    if not isinstance(data_list, list):
        return []
    items = []
    for item in data_list:
        items.append(get_localized_value(item, lang))
    return items 

def count_tokens(text: str) -> int:
    """
    Counts tokens in a text based on the rule that a token is about 4 characters.

    This implementation follows a simplified model:
    1. It first splits the text into word-like units using regular expressions.
       This separates letters and numbers from spaces and punctuation.
    2. For each word, it calculates the number of tokens by dividing its
       length by 4 and rounding up (e.g., 'cat' (3 chars) is 1 token, 
       'token' (5 chars) is 2 tokens).

    Args:
        text: The input string to be tokenized.

    Returns:
        The estimated number of tokens.
    """
    if not isinstance(text, str):
        raise TypeError("Input must be a string.")

    # Step 1: Split the text into word-like units.
    # \w+ matches sequences of word characters (letters, numbers, and underscore).
    # This effectively ignores spaces and punctuation.
    words = re.findall(r'\w+', text)

    total_tokens = 0
    
    # Step 2: Calculate tokens for each word and sum them up.
    for word in words:
        # The rule is "a token is equivalent to about 4 characters".
        # A 1-4 character word is 1 token.
        # A 5-8 character word is 2 tokens.
        # This is a perfect use case for ceiling division.
        tokens_in_word = math.ceil(len(word) / 4)
        total_tokens += tokens_in_word
        
    return total_tokens 

def is_path_empty(path: str) -> bool:
    import os

    if os.path.exists(path):
        if os.path.getsize(path) == 0:
            return True
        else:
            return False
    else:
        return True

# Function to encode images
def encode_image(image_path):
    """Convert image to base64 string."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")
    
# Function to encode images
def load_image_as_data_url(image_path):
    """Encode image as base64 data URL."""
    mime_type, _ = mimetypes.guess_type(image_path)
    with open(image_path, "rb") as image_file:
        image_data = image_file.read()
    base64_encoded = base64.b64encode(image_data).decode("utf-8")
    return f"data:{mime_type};base64,{base64_encoded}"

def generate_images(model_name: str, prompt: str, number_of_images: int = 1, aspect_ratio: str = "4:3") -> List[types.GeneratedImage]:
    client = genai.Client()

    try:        
        response = client.models.generate_images(
            model=model_name,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=number_of_images,
                aspect_ratio=aspect_ratio
            )
        )

        if not response.generated_images:
            raise ValueError("No images were generated.")
        
        return response.generated_images
    except Exception as e:
        print(f"Error generating images with {model_name}: {e}")
        raise e
    
def generate_images_multimodal(prompt: List[Union[str | Image.Image]]) -> Image.Image:
    client = genai.Client(
        vertexai=False
    )

    try:       
        generated_image = None
        response = client.models.generate_content(
            model="gemini-2.5-flash-image-preview",
            contents=prompt,
        )

        for part in response.candidates[0].content.parts:
            if part.text is not None:
                print(part.text)
            elif part.inline_data is not None:
                generated_image = Image.open(BytesIO(part.inline_data.data))

        if not generated_image:
            raise RuntimeError("Failed to generate image image.")

        return generated_image
        
    except Exception as e:
        print(f"Error generating images with gemini-2.5-flash-image-preview: {e}")
        raise e

def generate_images_cascade(prompt: str, number_of_images: int = 1, aspect_ratio: str = "4:3") -> List[types.GeneratedImage]:
    client = genai.Client()
    
    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[{"google_search": {}}],
                image_config=types.ImageConfig(
                    aspect_ratio=aspect_ratio,
                    image_size="1K"
                )
            )
        )

        image_parts = [part for part in response.parts if part.inline_data]
        if image_parts:
            image = image_parts[0].as_image()
            return [image]
        else:
            raise ValueError("No images were generated.")

    except Exception as e:
        print(f"Error generating images with gemini-3-pro-image-preview: {e}")

    try:        
        response = client.models.generate_images(
            model='imagen-4.0-generate-001',
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=number_of_images,
                aspect_ratio=aspect_ratio
            )
        )

        if not response.generated_images:
            raise ValueError("No images were generated.")
        
        return [ generatedImage.image for generatedImage in response.generated_images ]
    except Exception as e:
        print(f"Error generating images with imagen-4.0-generate-001: {e}")

    try:        
        response = client.models.generate_images(
            model='imagen-3.0-generate-002',
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=number_of_images,
                aspect_ratio=aspect_ratio
            )
        )

        if not response.generated_images:
            raise ValueError("No images were generated.")
        
        return [ generatedImage.image for generatedImage in response.generated_images ]
    except Exception as e:
        print(f"Error generating images with imagen-3.0-generate-002: {e}")

    try:        
        response = client.models.generate_images(
            model='imagen-4.0-ultra-generate-001',
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=number_of_images,
                aspect_ratio=aspect_ratio
            )
        )

        if not response.generated_images:
            raise ValueError("No images were generated.")
        
        return [ generatedImage.image for generatedImage in response.generated_images ]
    except Exception as e:
        print(f"Error generating images with imagen-4.0-ultra-generate-001: {e}")

    try:        
        response = client.models.generate_images(
            model='imagen-4.0-fast-generate-001',
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=number_of_images,
                aspect_ratio=aspect_ratio
            )
        )

        if not response.generated_images:
            raise ValueError("No images were generated.")
        
        return [ generatedImage.image for generatedImage in response.generated_images ]
    except Exception as e:
        print(f"Error generating images with imagen-4.0-fast-generate-001: {e}")

    try:        
        response = client.models.generate_images(
            model='imagen-3.0-fast-generate-001',
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=number_of_images,
                aspect_ratio=aspect_ratio
            )
        )

        if not response.generated_images:
            raise ValueError("No images were generated.")
        
        return [ generatedImage.image for generatedImage in response.generated_images ]
    except Exception as e:
        print(f"Error generating images with imagen-3.0-fast-generate-001: {e}")

    raise RuntimeError("All image generation attempts failed.")

    # try:        
    #     response = client.models.generate_images(
    #         model='imagen-3.0-fast-generate-001',
    #         prompt=prompt,
    #         config=types.GenerateImagesConfig(
    #             number_of_images=number_of_images,
    #             aspect_ratio=aspect_ratio
    #         )
    #     )

    #     if not response.generated_images:
    #         raise ValueError("No images were generated.")
        
    #     return response.generated_images
    # except Exception as e:
    #     print(f"Error generating images with imagen-3.0-fast-generate-001: {e}")

    raise RuntimeError("All image generation attempts failed.")

    # message = {
    #     "role": "user",
    #     "content": img_prompt,
    # }
    # response = image_model.invoke(
    #     [message],
    #     generation_config=dict(response_modalities=["TEXT", "IMAGE"]),
    # )
    # img_base64 = _get_image_base64(response)
    
    # save_base64_image(image_name, img_base64)

def generate_audio(prompt: str, voice_name="Kore", language_code: str = "en-US") -> bytes:
    client = genai.Client(
        vertexai=False
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash-preview-tts",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice_name,
                    )
                ),
                language_code=language_code
            ),
        )
    )

    if not response.candidates or not response.candidates[0].content.parts:
        raise ValueError("No audio content was generated.")

    return response.candidates[0].content.parts[0].inline_data.data

def generate_video(
    prompt: str,
    image: Image.Image,
    aspect_ratio: str = "16:9",
    path: str = None,
) -> List[types.GeneratedVideo]:
    
    try:
        client = genai.Client(
            vertexai=False
        )

        """Generates a single video clip from a text prompt and an image."""
        # Convert PIL Image to bytes for the API
        buffered = BytesIO()
        image.save(buffered, "PNG")
        img_bytes = buffered.getvalue()

        operation = client.models.generate_videos(
            model="veo-3.1-generate-preview",
            prompt=prompt,
            image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
            config=genai.types.GenerateVideosConfig(
                number_of_videos=1,
                aspect_ratio="16:9"
            ),
        )

        while not operation.done:
            time.sleep(10)
            operation = client.operations.get(operation)
        
        client.files.download(file=operation.response.generated_videos[0].video)
        operation.response.generated_videos[0].video.save(path)

        if is_path_empty(path):
            raise RuntimeError("Video generation with veo-3.1-generate-preview failed, file is empty.")

        return operation.response.generated_videos
    except Exception as e:
        print(f"Error generating video with veo-3.1-generate-preview: {e}")

    try:
        client = genai.Client(
            vertexai=False
        )

        """Generates a single video clip from a text prompt and an image."""
        # Convert PIL Image to bytes for the API
        buffered = BytesIO()
        image.save(buffered, "PNG")
        img_bytes = buffered.getvalue()

        operation = client.models.generate_videos(
            model="veo-3.1-fast-generate-preview",
            prompt=prompt,
            image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
            config=genai.types.GenerateVideosConfig(
                number_of_videos=1,
                aspect_ratio="16:9"
            ),
        )

        while not operation.done:
            time.sleep(10)
            operation = client.operations.get(operation)
        
        client.files.download(file=operation.response.generated_videos[0].video)
        operation.response.generated_videos[0].video.save(path)

        if is_path_empty(path):
            raise RuntimeError("Video generation with veo-3.1-fast-generate-preview failed, file is empty.")

        return operation.response.generated_videos
    except Exception as e:
        print(f"Error generating video with veo-3.1-fast-generate-preview: {e}")

    try:
        client = genai.Client(
            vertexai=False
        )

        """Generates a single video clip from a text prompt and an image."""
        # Convert PIL Image to bytes for the API
        buffered = BytesIO()
        image.save(buffered, "PNG")
        img_bytes = buffered.getvalue()

        operation = client.models.generate_videos(
            model="veo-3.0-generate-001",
            prompt=prompt,
            image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
            config=genai.types.GenerateVideosConfig(
                number_of_videos=1,
                aspect_ratio="16:9"
            ),
        )

        while not operation.done:
            time.sleep(10)
            operation = client.operations.get(operation)
        
        client.files.download(file=operation.response.generated_videos[0].video)
        operation.response.generated_videos[0].video.save(path)

        if is_path_empty(path):
            raise RuntimeError("Video generation with veo-3.0-generate-001 failed, file is empty.")

        return operation.response.generated_videos
    except Exception as e:
        print(f"Error generating video with veo-3.0-generate-001: {e}")

    try:
        client = genai.Client(
            vertexai=False
        )

        """Generates a single video clip from a text prompt and an image."""
        # Convert PIL Image to bytes for the API
        buffered = BytesIO()
        image.save(buffered, "PNG")
        img_bytes = buffered.getvalue()

        operation = client.models.generate_videos(
            model="veo-3.0-fast-generate-001",
            prompt=prompt,
            image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
            config=genai.types.GenerateVideosConfig(
                number_of_videos=1,
                aspect_ratio="16:9"
            ),
        )

        while not operation.done:
            time.sleep(10)
            operation = client.operations.get(operation)
        
        client.files.download(file=operation.response.generated_videos[0].video)
        operation.response.generated_videos[0].video.save(path)

        if is_path_empty(path):
            raise RuntimeError("Video generation with veo-3.0-fast-generate-001 failed, file is empty.")

        return operation.response.generated_videos
    except Exception as e:
        print(f"Error generating video with veo-3.0-fast-generate-001: {e}")

    raise RuntimeError("All video generation attempts failed.")

    

def generate_video_vertexai(
    prompt: str,
    image: Image.Image,
    output_gcs_uri: str,
    aspect_ratio: str = "16:9",
) -> List[types.GeneratedVideo]:
    
    client = genai.Client(vertexai=True)

    """Generates a single video clip from a text prompt and an image."""
    # Convert PIL Image to bytes for the API
    buffered = BytesIO()
    image.save(buffered, "PNG")
    img_bytes = buffered.getvalue()

    operation = client.models.generate_videos(
        model="veo-3.0-generate-preview",
        prompt=prompt,
        image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
        config=genai.types.GenerateVideosConfig(
            aspect_ratio="16:9",
            number_of_videos=1,
            output_gcs_uri=output_gcs_uri
        ),
    )

    while not operation.done:
        time.sleep(10)
        operation = client.operations.get(operation)

    # print(operation.result.generated_videos[0].video.uri)
    # return operation.result.generated_videos
    
    if operation.response:
        print(operation.result.generated_videos[0].video.uri)
        return operation.result.generated_videos
    else:
        raise RuntimeError("Video generation operation failed.")

def edit_image(
    image: Image.Image,
    prompt: str,
) -> Image.Image:
    
    client = genai.Client(
        vertexai=False
    )

    """Edits an image with a text prompt."""
    prompt = f"Edit the image to fit the following prompt: {prompt}"
    # Convert PIL Image to bytes for the API
    buffered = BytesIO()
    image.save(buffered, format="PNG")
    img_bytes = buffered.getvalue()

    response = client.models.generate_content(
        model="gemini-2.0-flash-preview-image-generation",
        contents=[
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": img_bytes,
                        }
                    },
                ],
            },
        ],
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
        ),
    )

    edited_image = None
    for part in response.candidates[0].content.parts:
        if part.text is not None:
            ""
        
        if part.inline_data is not None:
            edited_image = Image.open(BytesIO((part.inline_data.data)))

    if not edited_image:
        raise RuntimeError("Failed to edit image.")

    return edited_image