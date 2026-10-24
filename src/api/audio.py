import logging

from fastapi import APIRouter, UploadFile, File, Request, status
from fastapi.responses import JSONResponse

from controllers import AudioController
from models import ResponseMessage

logger = logging.getLogger(__name__)

audio_router = APIRouter(prefix="/api/v1/audio", tags=["api_v1","audio"])


@audio_router.post("/transcribe")
def transcribe_audio(request: Request, file: UploadFile = File(...), language: str | None = None):
    
    
    audio_controller = AudioController()

    is_valid, message = audio_controller.validate_audio(file)
    
    if not is_valid:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"Message": message},
        )


    temp_path = audio_controller.save_temp(file)
    
    
    try:
        
        result = request.app.state.whisper.transcribe(temp_path, language)
        
    except Exception as e:
        
        logger.error(f"Error while transcribing audio: {e}")
        
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"Message": ResponseMessage.AUDIO_TRANSCRIBE_FAILED.value},
        )
        
    finally:
        audio_controller.cleanup(temp_path)   # always delete the temp file


    if not result["text"]:
        
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"Message": ResponseMessage.AUDIO_EMPTY_TRANSCRIPT.value},
        )

    return JSONResponse(status_code=status.HTTP_200_OK, content=result)