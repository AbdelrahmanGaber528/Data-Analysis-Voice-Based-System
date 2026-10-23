from fastapi import FastAPI , Depends , UploadFile , APIRouter , status
from fastapi.responses import JSONResponse
from helpers.config import get_settings , Settings
from controllers import DataController , ItemController , ProcessController
from models import ResponseMessage
import os
import aiofiles
import logging
from .schema.data import ProcessRequest



logger = logging.getLogger("uvicorn.error")



data_router = APIRouter(
    prefix="/api/v1/data",
    tags=["api_v1","data"]
)



@data_router.post("/upload/{item_id}")
async def upload_data(item_id : str , file : UploadFile , app_settings : Settings = Depends(get_settings)):

    data_controller = DataController()
    item_controller = ItemController()
    
    is_valid , result_message = data_controller.validate_uploaded_file(file=file)
    
    if not is_valid :
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "Message":result_message
            }
        )
        
    item_dir_path = item_controller.get_item_path(item_id=item_id)
    
    file_path = os.path.join( item_dir_path , file.filename )
    
    
    # we will load file chunk by chunk for effiecient memory loading
    try :
        
        async with aiofiles.open(file_path , "wb") as f :
            while chunk := await file.read(app_settings.FILE_CHUNK_SIZE):
                await f.write(chunk)
    
    except Exception as e :
        
        logger.error(f"Error While Uploading File : {e}.")
           
        return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "Message":ResponseMessage.File_Upload_Failed.value
        }
    )    
               
            
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "Message":ResponseMessage.File_Upload_Success.value
        }
    )
    
    
    
    
    
    
@data_router.post("/process/{item_id}")
async def process_file(item_id : str , process_request : ProcessRequest):
    
    file_id = process_request.file_id
    chunk_size = process_request.chunk_size
    overlap_size = process_request.overlap_size
    
    
    processs_controller = ProcessController(item_id)
    
    file_content = processs_controller.get_file_content(file_id)
    
    
    file_chunks = processs_controller.process_file_content(file_content,file_id , chunk_size , overlap_size)
    
    
    if file_chunks is None or len(file_chunks) == 0 :
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ResponseMessage.PROCESSING_FAILED
        )
        
        
    return len(file_chunks) # for now ...