from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


SRC_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    APP_NAME: str
    APP_VERSION: str
    API_KEY: str
    MODEL_NAME: str

    model_config = SettingsConfigDict(
        env_file=SRC_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def get_settings():
    return Settings()
