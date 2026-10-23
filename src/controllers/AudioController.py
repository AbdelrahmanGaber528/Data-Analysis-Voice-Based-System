import os
import shutil
import tempfile

from fastapi import UploadFile

from .BaseController import BaseController
from models import ResponseMessage


class AudioController(BaseController):

    def __init__(self):
        super().__init__()
        self.scale = 1048576



    def validate_audio(self, file: UploadFile):
        
        extension = file.filename.split(".")[-1].lower()

        if extension not in self.app_settings.AUDIO_ALLOWED_EXTENSION:
            return False, ResponseMessage.AUDIO_TYPE_NOT_SUPPORTED.value

        if file.size and file.size > self.app_settings.AUDIO_MAX_SIZE * self.scale:
            return False, ResponseMessage.AUDIO_SIZE_EXCEEDED.value

        return True, ResponseMessage.AUDIO_UPLOADED_SUCCESS



    def save_temp(self, file: UploadFile):
        
        suffix = os.path.splitext(file.filename or "")[-1].lower()
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            
        return tmp.name


    @staticmethod
    def cleanup(path: str):
        if path and os.path.exists(path):
            os.remove(path)