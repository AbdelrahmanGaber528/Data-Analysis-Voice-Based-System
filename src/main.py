from contextlib import asynccontextmanager
from fastapi import FastAPI
from api import base_router , data_router , audio_router
from clients.whisper import WhisperClient
from helpers.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    
    s = get_settings()
    
    app.state.whisper = WhisperClient(
        s.WHISPER_MODEL_SIZE,
        s.WHISPER_DEVICE,
        s.WHISPER_COMPUTE_TYPE,
    )
    
    yield


app = FastAPI(lifespan=lifespan, title="DA Voice System" , description="data analysis platform to upload your data , and ask questions , apply queries , make descisions about it in same place ")


app.include_router(base_router)
app.include_router(data_router)
app.include_router(audio_router)



@app.get("/health")
async def check_health():
    
    return {"status":"OK , server on"}