from fastapi import FastAPI , Depends , UploadFile , APIRouter
from helpers.config import get_settings , Settings
from controllers import DataController

data_router = APIRouter(
    prefix="/api/v1/data",
    tags=["api_v1","data"]
)


@data_router.post("/upload/{item_id}")
async def upload_data(item_id : str , file : UploadFile , app_settings : Settings = Depends(get_settings)):

    data_controller = DataController()
    is_valid , result_message = data_controller.validate_uploaded_file(file=file)
    
    return {
        "Result" : is_valid,
        "Message" : result_message
    }