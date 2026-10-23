from enum import Enum


class ResponseMessage(str, Enum):
    
    FILE_VALIDATED_SUCCESS = "File_Validated_Success"
    FILE_TYPE_NOT_SUPPORTED = "File_Type_Not_Supported"
    FILE_SIZE_EXCEEDED = "File_Size_Exceeded"
    FILE_UPLOAD_SUCCESS = "File_Upload_Success"
    FILE_UPLOAD_FAILED = "File_Upload_Failed"
    
    PROCESSING_SUCCESS = "Process File Success"
    PROCESSING_FAILED = "Process File Failed"
    
    AUDIO_TYPE_NOT_SUPPORTED = "Audio_Type_Not_Supported"
    AUDIO_SIZE_EXCEEDED = "Audio_Size_Exceeded"
    
    AUDIO_TRANSCRIBE_FAILED = "Audio_Transcribe_Failed"
    AUDIO_EMPTY_TRANSCRIPT = "Audio_Empty_Transcript"
    
    AUDIO_UPLOADED_SUCCESS = "Audio_Upload_Success"
    
    DATASET_NOT_FOUND = "Dataset_Not_Found"
    
    ANALYSIS_EMPTY_QUESTION = "Analysis_Empty_Question"
    ANALYSIS_INVALID_REQUEST = "Analysis_Invalid_Request"
    ANALYSIS_FAILED = "Analysis_Failed"