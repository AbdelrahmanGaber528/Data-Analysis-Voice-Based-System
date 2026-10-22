from fastapi import FastAPI , APIRouter
import os


base_router = APIRouter(
    prefix="/api/v1",
    tags=["api_v1"]
)


@base_router.get("/")
async def startup():
    
    app_name = os.getenv("APP_NAME")
    app_version = os.getenv("APP_VESION")
    
    
    return {
        "APP Name" : app_name ,
        "APP Version" : app_version
        }
    

@base_router.get("/health")
async def check_health():

    return {"status":"OK , server on"}