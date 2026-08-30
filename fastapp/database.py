from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from pymongo.errors import ConnectionFailure, OperationFailure
from base64 import b64decode
import os
import time
from pathlib import Path
from pymongo.encryption import ClientEncryption, Algorithm
from dotenv import load_dotenv
from pathlib import Path

# Load .env from the fastapp directory
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path, override=True)
db = None
client_encryption = None

MONGODB_URI = os.environ.get("MONGODB_URI")
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE")
MONGO_KEY = os.environ.get("MONGO_KEY")

# Schema map kept for reference of what fields need encryption

def get_db():
    global db
    if db is None:
        raise RuntimeError("Database not initialized")
    return db

def get_client_encryption(client):
    global client_encryption
    if not client_encryption:
        kms_providers = {
            "local": {
                "key": b64decode(os.environ['MONGO_KEY'])
            }
        }
        client_encryption = ClientEncryption(
            kms_providers,
            "encryption.__keyVault",
            client,
            client.codec_options
        )
    return client_encryption

def encrypt_field(value, is_deterministic=False):
    """Explicitly encrypt a field value"""
    if not client_encryption:
        raise RuntimeError("Client encryption not initialized")
    
    algorithm = Algorithm.AEAD_AES_256_CBC_HMAC_SHA_512_Deterministic if is_deterministic else Algorithm.AEAD_AES_256_CBC_HMAC_SHA_512_Random
    return client_encryption.encrypt(
        value,
        algorithm,
        key_alt_name="data_key"
    )

def decrypt_field(value):
    """Explicitly decrypt a field value"""
    if not client_encryption:
        raise RuntimeError("Client encryption not initialized")
    return client_encryption.decrypt(value)

def init_db(max_retries=3, retry_delay=2):
    global db
    global client_encryption
    retry_count = 0
    last_error = None

    # # Get the path to mongo_crypt_shared library from mongo_lib
    # lib_path = str(Path(__file__).parent.parent / 'mongo_lib' / 'lib' /
    #                ('mongo_crypt_v1.dll' if os.name == 'nt' else
    #                 'mongo_crypt_v1.dylib' if os.name == 'darwin' else
    #                 'mongo_crypt_v1.so'))

    # if not os.path.exists(lib_path):
    #     raise RuntimeError(
    #         "mongo_crypt_shared library not found in mongo_lib/lib directory. "
    #         "Please ensure the MongoDB Enterprise package is properly installed."
    #     )

    while retry_count < max_retries:
        try:
            if not MONGODB_URI:
                raise ValueError("MONGODB_URI configuration is missing")
            
            if not MONGODB_DATABASE:
                raise ValueError("MONGODB_DATABASE configuration is missing")
                
            if not MONGO_KEY:
                raise ValueError("MONGO_KEY configuration is missing")

            # Clean URI string
            mongodb_uri = MONGODB_URI.strip('"').strip("'")
            
            # Create client without auto encryption
            client = MongoClient(
                mongodb_uri,
                server_api=ServerApi('1'),
            )
            
            # Initialize client encryption
            get_client_encryption(client)
            
            # Test connection with timeout
            client.admin.command('ping')
            
            # Set the global db variable
            db = client[MONGODB_DATABASE]

            # Verify we can actually perform operations
            db.command('ping')
            return 

        except Exception as e:
            last_error = e
            db = None
            retry_count += 1
            if retry_count < max_retries:
                time.sleep(retry_delay)
            continue

    raise RuntimeError(f"Failed to initialize MongoDB: {str(last_error)}")
