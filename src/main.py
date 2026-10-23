from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from api import base_router , data_router , audio_router , explain_router
from clients.whisper import WhisperClient
from clients.llm import LLMClient
from helpers.config import get_settings , Settings
from helpers.logging_config import setup_logging


setup_logging()
import logging
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    
    app_settings = get_settings()
    
    logger.info("Starting DA Voice System...")
    
    app.state.whisper = WhisperClient(
        app_settings.WHISPER_MODEL_SIZE,
        app_settings.WHISPER_DEVICE,
        app_settings.WHISPER_COMPUTE_TYPE,
    )
    
    app.state.llm = LLMClient(
        app_settings.LLM_BASE_URL,
        app_settings.API_KEY,
        app_settings.MODEL_NAME,
    )
    
    logger.info("LLM and Whisper clients initialized")
    
    yield
    
    logger.info("Shutting down DA Voice System...")


app = FastAPI(lifespan=lifespan, title="DA Voice System" , description="data analysis platform to upload your data , and ask questions , apply queries , make descisions about it in same place ")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(base_router)
app.include_router(data_router)
app.include_router(audio_router)
app.include_router(explain_router)


logger.info("Routers registered")


@app.get("/health")
async def check_health():
    
    logger.info("Health check requested")
    
    return {"status":"OK , server on"}


# Mount static frontend
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")