from fastapi import FastAPI , Depends , UploadFile , APIRouter , Request , status
from fastapi.responses import JSONResponse
from helpers.config import get_settings , Settings
from controllers import DataController , DataSetController , ProcessController , SQLiteController
from models import ResponseMessage
import os
import aiofiles
import logging
from .schema.data import ProcessRequest , AnalyzeRequest



logger = logging.getLogger("uvicorn.error")



data_router = APIRouter(
    prefix="/api/v1/data",
    tags=["api_v1","data"]
)



@data_router.post("/upload/{dataset_id}")
async def upload_data(dataset_id : str , file : UploadFile , app_settings : Settings = Depends(get_settings)):

    data_controller = DataController()
    dataset_controller = DataSetController()
    
    is_valid , result_message = data_controller.validate_uploaded_file(file=file)
    
    if not is_valid :
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "Message":result_message
            }
        )
        
    dataset_dir_path = dataset_controller.get_dataset_path(dataset_id)
    
    file_path = os.path.join( dataset_dir_path , file.filename )
    
    
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
            "Message":ResponseMessage.FILE_UPLOAD_FAILED.value
        }
    )    
               
            
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "Message":ResponseMessage.FILE_UPLOAD_SUCCESS.value
        }
    )
    
    
    
    
    
    
@data_router.post("/process/{dataset_id}")
async def process_file(dataset_id : str , process_request : ProcessRequest):
    
    file_id = process_request.file_id
    chunk_size = process_request.chunk_size
    overlap_size = process_request.overlap_size
    
    
    processs_controller = ProcessController(dataset_id)
    
    file_content = processs_controller.get_file_content(file_id)
    
    
    file_chunks = processs_controller.process_file_content(file_content,file_id , chunk_size , overlap_size)
    
    
    if file_chunks is None or len(file_chunks) == 0 :
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "Message": ResponseMessage.PROCESSING_FAILED.value
            }
        )
        
        
    return len(file_chunks) # for now ...



@data_router.post("/analyze/{dataset_id}")
def analyze_data(dataset_id : str , analyze_request : AnalyzeRequest , request : Request):
    
    question = analyze_request.question.strip()
    
    if not question :
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "Message": ResponseMessage.ANALYSIS_EMPTY_QUESTION.value
            }
        )
        
        
    try :
        
        sqlite_controller = SQLiteController(dataset_id)
        
        analysis_result = sqlite_controller.analyze(question , request.app.state.llm , limit=analyze_request.limit)
        
    except FileNotFoundError as e :
        
        logger.warning(f"Dataset not found for analysis : {e}.")
        
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "Message": ResponseMessage.DATASET_NOT_FOUND.value
            }
        )
        
    except ValueError as e :
        
        logger.warning(f"Invalid analysis request : {e}.")
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "Message": ResponseMessage.ANALYSIS_INVALID_REQUEST.value,
                "Detail": str(e)
            }
        )
        
    except Exception as e :
        
        logger.error(f"Error While Analyzing Dataset : {e}.")
        
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "Message": ResponseMessage.ANALYSIS_FAILED.value
            }
        )
        
        
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content=analysis_result
    )