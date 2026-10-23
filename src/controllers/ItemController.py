from .BaseController import BaseController
import os


class ItemController(BaseController):
    
    def __init__(self):
        
        super().__init__()
        
        
    def get_item_path(self , item_id : str):
        
        item_dir = os.path.join(
            self.file_dir,
            item_id
        )
        
        if not os.path.exists(item_dir):
            os.makedirs(item_dir)
            
        
        return item_dir