from .BaseController import BaseController
from fastapi import UploadFile
from models import ResponseMessage


class DataController(BaseController):
    
    def __init__(self):
        super().__init__()
        self.scale = 1048576
        
        
    def validate_uploaded_file(self , file : UploadFile):
        
        extension = file.filename.split(".")[-1].lower()
        
        if extension not in self.app_settings.FILE_ALLOWED_EXTENSION :
            return False , ResponseMessage.FILE_TYPE_NOT_SUPPORTED
        
        if file.size > self.app_settings.FILE_MAX_SIZE * self.scale :
            return False , ResponseMessage.FILE_SIZE_EXCEEDED
        
        
        return True , ResponseMessage.FILE_UPLOAD_SUCCESS