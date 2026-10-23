from .BaseController import BaseController
from fastapi import UploadFile
from models import ResponseMessage


class DataController(BaseController):
    
    def __init__(self):
        super().__init__()
        self.scale = 1048576
        
        
    def validate_uploaded_file(self , file : UploadFile , filename : str | None = None):
        
        name = filename or file.filename or ""
        extension = name.rsplit(".", 1)[-1].lower()
        
        if extension not in self.app_settings.FILE_ALLOWED_EXTENSION :
            return False , ResponseMessage.FILE_TYPE_NOT_SUPPORTED.value
        
        if file.size is not None and file.size > self.app_settings.FILE_MAX_SIZE * self.scale :
            return False , ResponseMessage.FILE_SIZE_EXCEEDED.value
        
        
        return True , ResponseMessage.FILE_UPLOAD_SUCCESS.value