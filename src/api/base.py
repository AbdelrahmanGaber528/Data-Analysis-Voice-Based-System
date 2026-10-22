from fastapi import FastAPI , APIRouter
from helpers.config import get_settings

base_router = APIRouter(
    prefix="/api/v1",
    tags=["api_v1"]
)


@base_router.get("/")
async def startup():
    
    app_settings = get_settings()
    
    app_name = app_settings.APP_NAME
    app_version = app_settings.APP_VERSION
    
    
    return {
        "APP Name" : app_name ,
        "APP Version" : app_version
        }
    

@base_router.get("/health")
async def check_health():

    return {"status":"OK , server on"}