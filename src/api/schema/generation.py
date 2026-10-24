from pydantic import BaseModel, Field
from typing import Optional


class GenerateRequest(BaseModel):

    query: Optional[str] = None
    context: Optional[str] = None
    language: Optional[str] = None
    history: list[dict] = Field(default_factory=list)
