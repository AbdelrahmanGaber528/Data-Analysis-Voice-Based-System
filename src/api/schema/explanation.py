from pydantic import BaseModel, Field
from typing import Optional


class ExplainRequest(BaseModel):

    query: Optional[str] = None
    code: Optional[str] = None
    question: Optional[str] = None
    context: Optional[str] = None
    language: Optional[str] = None
    history: list[dict] = Field(default_factory=list)
