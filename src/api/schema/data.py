from pydantic import BaseModel, Field
from typing import Optional

class ProcessRequest(BaseModel):
    
    file_id : str
    chunk_size : Optional[int] = 200
    overlap_size : Optional[int] = 20
    do_reset : Optional[int] = 0


class AnalyzeRequest(BaseModel):
    
    question : str
    limit : Optional[int] = None
    history: list[dict] = Field(default_factory=list)
