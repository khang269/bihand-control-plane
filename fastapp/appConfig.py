# app/appConfig.py
import os
from dotenv import load_dotenv

load_dotenv(override=True)

class Config:
    DEBUG = False
    TESTING = False
    MONGODB_URI = os.environ.get("MONGODB_URI")
    MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "sant")
    MONGO_KEY = os.environ.get("MONGO_KEY")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY")
    GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

class DevelopmentConfig(Config):
    DEBUG = True

class ProductionConfig(Config):
    pass

class TestingConfig(Config):
    TESTING = True
    MONGODB_DATABASE = "testDatabase"

configByName = dict(
    dev=DevelopmentConfig,
    prod=ProductionConfig,
    test=TestingConfig
)

def getAppConfig(configName):
    return configByName.get(configName, ProductionConfig)