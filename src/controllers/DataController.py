from .BaseController import BaseController
from fastapi import UploadFile


class DataController(BaseController):
    
    def __init__(self):
        super().__init__()
        self.scale = 1048576
        
        
    def validate_uploaded_file(self , file : UploadFile):
        
        extension = file.filename.split(".")[-1].lower()
        
        if extension not in self.app_settings.FILE_ALLOWED_EXTENSION :
            return False , "File type not allowed"
        
        if file.size > self.app_settings.FILE_MAX_SIZE * self.scale : 
            return False , "File size Exceeded"
        
        
        return True , "Success"