from enum import Enum


class ResponseMessage(Enum):
    
    FILE_VALIDATED_SUCCESS = "File_Validated_Success"
    FILE_TYPE_NOT_SUPPORTED = "File_Type_Not_Supported"
    FILE_SIZE_EXCEEDED = "File_Size_Exceeded"
    FILE_UPLOAD_SUCCESS = "File_Upload_Success"
    FILE_UPLOAD_FAILED = "File_Upload_Failed"