from pydantic import BaseModel
from typing import Optional

class ProcessRequest(BaseModel):
    
    file_id : str
    chunk_size : Optional[int] = 200
    overlap_size : Optional[int] = 20
    do_reset : Optional[int] = 0