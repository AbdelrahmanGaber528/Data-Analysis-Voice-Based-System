from .BaseController import BaseController
from fastapi import UploadFile
from models import ResponseEnum


class DataController(BaseController):
    
    def __init__(self):
        super().__init__()
        self.scale = 1048576
        
        
    def validate_uploaded_file(self , file : UploadFile):
        
        extension = file.filename.split(".")[-1].lower()
        
        if extension not in self.app_settings.FILE_ALLOWED_EXTENSION :
            return False , ResponseEnum.ResponseMessage.FILE_TYPE_NOT_SUPPORTED
        
        if file.size > self.app_settings.FILE_MAX_SIZE * self.scale :
            return False , ResponseEnum.ResponseMessage.FILE_SIZE_EXCEEDED
        
        
        return True , ResponseEnum.ResponseMessage.FILE_UPLOAD_SUCCESS