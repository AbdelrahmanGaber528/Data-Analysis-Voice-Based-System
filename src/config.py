from pydantic_settings import BaseSettings , SettingsConfigDict


class Settings(BaseSettings):
    
    
    APP_NAME : str
    APP_VERSION : str
    API_KEY : str
    MODEL_NAME : str
    
    class config:
        env_file = ".env"
    
    
def get_settings():
    return Settings()


