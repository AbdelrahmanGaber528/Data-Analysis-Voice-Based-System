from typing import Optional
from pydantic import BaseModel


class ExplainRequest(BaseModel):

    query: Optional[str] = None
    code: Optional[str] = None
    question: Optional[str] = None
    context: Optional[str] = None
    language: Optional[str] = None
    history: list[dict] = []
