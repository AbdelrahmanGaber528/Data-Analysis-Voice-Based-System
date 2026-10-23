from .BaseController import BaseController
import os


class DataSetController(BaseController):
    
    def __init__(self):
        
        super().__init__()
        
        
    def get_dataset_path(self , dataset_id : str):
        
        dataset_dir = os.path.join(
            self.file_dir,
            dataset_id
        )
        
        if not os.path.exists(dataset_dir):
            os.makedirs(dataset_dir)
            
        
        return dataset_dir