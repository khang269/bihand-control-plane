import hashlib
import time
import uuid
import os
import re
import logging
import requests
import jwt
import shutil
import tempfile
from datetime import datetime, timedelta

import base64
from base64 import b64decode
from google.cloud import storage
import google.auth
from google.auth.transport import requests

from dotenv import load_dotenv

load_dotenv(override=True)

GOOGLE_SERVICE_ACCOUNT = os.getenv("GOOGLE_SERVICE_ACCOUNT", "your-service-account-email")

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def get_domain(url: str):
    """
    Extract the domain from a URL.
    """
    domain = url.split("/")[2]
    return domain.replace("www.", "") if domain.startswith("www.") else domain

def upload_to_gcs(bucket_name, source_file_name, destination_blob_name):
    """Uploads a file to the bucket."""
    if not destination_blob_name.startswith("bihand/"):
        destination_blob_name = f"bihand/{destination_blob_name}"
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)

    blob.upload_from_filename(source_file_name)
    print(f"File {source_file_name} uploaded to {destination_blob_name}.")

def upload_directory_to_gcs(bucket_name, source_directory, destination_prefix=""):
    """Uploads an entire local directory (including subdirectories) to GCS.

    Args:
        bucket_name (str): The name of your GCS bucket.
        source_directory (str): The path to the local directory to upload.
        destination_prefix (str): An optional prefix for the GCS object names
                                  (e.g., 'my_folder/' to upload into a virtual folder).
    """
    if destination_prefix and not destination_prefix.startswith("bihand/"):
        destination_prefix = f"bihand/{destination_prefix}"
    elif not destination_prefix:
        destination_prefix = "bihand/"
        
    client = storage.Client()
    bucket = client.bucket(bucket_name)

    for root, _, files in os.walk(source_directory):
        for file_name in files:
            local_file_path = str(os.path.join(root, file_name))

            # Construct the GCS object name
            # If destination_prefix is provided, it will be prepended
            gcs_object_name = os.path.join(destination_prefix, local_file_path).replace("\\", "/") 
            # Ensure forward slashes for GCS

            blob = bucket.blob(gcs_object_name)
            blob.upload_from_filename(local_file_path)
            print(f"Uploaded {local_file_path} to gs://{bucket_name}/{gcs_object_name}")

def upload_base64_to_gcs(bucket_name, base64_string, destination_blob_name, content_type: str):
    if not destination_blob_name.startswith("bihand/"):
        destination_blob_name = f"bihand/{destination_blob_name}"
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)

    # Decode and Upload
    file_data = base64.b64decode(base64_string)
    blob.upload_from_string(file_data, content_type=content_type)


# Example usage:
# If you have a directory named 'my_local_data' with subdirectories and files
# and you want to upload it to a bucket named 'my-gcs-bucket'
# into a virtual folder called 'uploaded_data/'
# upload_directory_to_gcs("my-gcs-bucket", "my_local_data", "uploaded_data/")

def download_file_from_uri(url, save_path):
    """
    Downloads a file from a given URL and saves it to a specified directory.
    """
    try:
        # Send a GET request to the URL with streaming enabled for large files
        response = requests.get(url, stream=True)
        response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)

        # Save the content in chunks to handle large files efficiently
        with open(save_path, 'wb') as file:
            for chunk in response.iter_content(chunk_size=8192):
                file.write(chunk)

        print(f"File downloaded successfully to: {save_path}")

    except requests.exceptions.RequestException as e:
        print(f"Error during download: {e}")
        raise e
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise e
    
def is_path_empty(path: str) -> bool:
    import os

    if os.path.exists(path):
        if os.path.getsize(path) == 0:
            return True
        else:
            return False
    else:
        return True

def generate_download_signed_url_v4(bucket_name, blob_name, expiration_time=3600):
    """Generates a v4 signed URL for downloading a blob."""
    url_expiration = timedelta(seconds=expiration_time)  # URL will be valid for 1 hour

    try:
        # Standard native signing (uses local file key if available)
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        url = blob.generate_signed_url(
            version="v4",
            expiration=url_expiration,
            method="GET"
        )
        print(f"Generated a signed URL natively for {blob_name}")
        return url
    except Exception as e:
        # Fallback: Workload Identity / IAM signBlob signature delegation
        print(f"Standard signing failed ({e}). Attempting Workload Identity signing delegation...")
        try:
            import google.auth
            from google.auth.transport.requests import Request

            credentials, project = google.auth.default()
            auth_request = Request()
            credentials.refresh(auth_request)

            storage_client = storage.Client(credentials=credentials)
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)

            sa_email = GOOGLE_SERVICE_ACCOUNT
            if not sa_email or sa_email == "your-service-account-email":
                if hasattr(credentials, "service_account_email") and credentials.service_account_email:
                    sa_email = credentials.service_account_email

            if not sa_email:
                raise ValueError("GOOGLE_SERVICE_ACCOUNT is required for IAM SignBlob signature delegation.")

            url = blob.generate_signed_url(
                version="v4",
                expiration=url_expiration,
                method="GET",
                service_account_email=sa_email,
                access_token=credentials.token,
            )
            print(f"Generated a signed URL via Workload Identity delegation for {blob_name}")
            return url
        except Exception as fallback_e:
            print(f"Error generating fallback signed URL: {fallback_e}")
            return None
    
def cleanup_local_files(*filenames):
    """Deletes one or more local files."""
    for filename in filenames:
        try:
            os.remove(filename)
            print(f"Successfully deleted local file: {filename}")
        except OSError as e:
            print(f"Error deleting file {filename}: {e}")

def write_base64_to_file(base64_string, file_path):
    """
    Decodes a Base64 encoded string and writes it to a file.

    Args:
        base64_string (str): The Base64 encoded string.
        file_path (str): The path where the decoded file will be saved.
    """
    try:
        # Decode the Base64 string to binary data
        file_data = base64.b64decode(base64_string)

        # Write the binary data to the specified file
        with open(file_path, 'wb') as file:
            file.write(file_data)

        print(f"Successfully wrote Base64 data to file: {file_path}")

    except base64.binascii.Error as e:
        print(f"Error decoding Base64 string: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

def write_base64_image_to_tempfile(base64_string, filename_prefix="image", filename_suffix=".png"):
    """
    Decodes a Base64 encoded image string and writes it to a temporary file.

    Args:
        base64_string (str): The Base64 encoded image string.
        filename_prefix (str, optional): Prefix for the temporary filename. Defaults to "image".
        filename_suffix (str, optional): Suffix (extension) for the temporary filename. Defaults to ".png".

    Returns:
        str: The path to the created temporary file.
    """
    try:
        # Decode the Base64 string to binary data
        image_data = base64.b64decode(base64_string)

        # Create a temporary file
        # delete=False ensures the file is not deleted automatically when closed,
        # allowing you to use it after the 'with' block.
        with tempfile.NamedTemporaryFile(mode='wb', delete=False, 
                                         prefix=filename_prefix, suffix=filename_suffix) as temp_file:
            temp_file.write(image_data)
            temp_file_path = temp_file.name

        return temp_file_path

    except base64.binascii.Error as e:
        print(f"Error decoding Base64 string: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None

def save_base64_image(filename: str, b64_string: str) -> None:
    """Decodes a base64 string and saves it as an image file."""
    try:
        with open(filename, "wb") as f:
            f.write(base64.b64decode(b64_string))
        print(f"Successfully saved image locally to: {filename}")
    except Exception as e:
        print(f"Error saving base64 image: {e}")
        raise e
    
def save_base64_to_file(filename: str, b64_string: str) -> None:
    """Decodes a base64 string and saves it as an image file."""
    try:
        with open(filename, "wb") as f:
            f.write(base64.b64decode(b64_string))
        print(f"Successfully saved image locally to: {filename}")
    except Exception as e:
        print(f"Error saving base64 image: {e}")
        raise e
    
def save_base64_pdf(
        path: str,
        b64_string: str
):
    # Decode the Base64 string, making sure that it contains only valid characters
    bytes = b64decode(b64_string, validate=True)

    # Perform a basic validation to make sure that the result is a valid PDF file
    # Be aware! The magic number (file signature) is not 100% reliable solution to validate PDF files
    # Moreover, if you get Base64 from an untrusted source, you must sanitize the PDF contents
    # if bytes[0:4] != b'%PDF':
    #     raise ValueError('Missing the PDF file signature')

    # Write the PDF contents to a local file
    f = open(path, 'wb')
    f.write(bytes)
    f.close()

def make_dirs_if_not_exists(directory: str) -> None:
    """Creates directories if they do not exist."""
    if not os.path.exists(directory):
        os.makedirs(directory)

def remove_dir_if_exists(directory: str) -> None:
    """Removes a directory if it exists."""
    if os.path.exists(directory):
        shutil.rmtree(directory)
