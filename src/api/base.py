from fastapi import FastAPI , APIRouter , Depends
from helpers.config import get_settings

base_router = APIRouter(
    prefix="/api/v1",
    tags=["api_v1"]
)


@base_router.get("/")
async def startup(app_settings = Depends(get_settings)):
        
    app_name = app_settings.APP_NAME
    app_version = app_settings.APP_VERSION
    
    
    return {
        "APP Name" : app_name ,
        "APP Version" : app_version
        }