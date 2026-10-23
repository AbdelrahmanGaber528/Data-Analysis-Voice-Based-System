from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


SRC_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    
    APP_NAME: str
    APP_VERSION: str
    
    LLM_BASE_URL: str
    API_KEY: str
    MODEL_NAME: str

    HF_TOKEN: str | None = None
    
    FILE_ALLOWED_EXTENSION : list[str]
    FILE_MAX_SIZE : int
    FILE_CHUNK_SIZE : int
    
    AUDIO_MAX_SIZE : int
    AUDIO_ALLOWED_EXTENSIONS : list[str]
    
    WHISPER_MODEL_SIZE: str
    WHISPER_DEVICE: str
    WHISPER_COMPUTE_TYPE: str
    
    
    model_config = SettingsConfigDict(
        env_file=SRC_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def get_settings():
    return Settings()
