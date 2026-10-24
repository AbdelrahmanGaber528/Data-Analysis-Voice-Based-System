from pydantic import BaseModel, Field
from typing import Optional


class GenerateRequest(BaseModel):

    query: Optional[str] = None
    context: Optional[str] = None
    code: Optional[str] = None
    language: Optional[str] = None
    conversation_id: Optional[str] = None
    correction: bool = False
    history: list[dict] = Field(default_factory=list)
