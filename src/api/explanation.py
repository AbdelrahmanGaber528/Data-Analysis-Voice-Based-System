from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse
from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from api.schema.explanation import ExplainRequest
from helpers.conversation import to_chat_messages
from helpers.prompts import load_prompt


explain_router = APIRouter(prefix="/api/v1/explain", tags=["api_v1", "explain"])


@explain_router.post("")
def explain_code(explain_request: ExplainRequest, request: Request):

    query = (explain_request.query or explain_request.code or explain_request.question or "").strip()

    if not query:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"message": "Provide code or question to explain."},
        )

    details = []
    
    if explain_request.language:
        details.append(f"LANGUAGE: {explain_request.language}")
        
        
    if explain_request.context:
        details.append(f"CONTEXT: {explain_request.context}")
        
        
    if details:
        query = "\n".join(details) + f"\n\n{query}"


    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=load_prompt("explain")),
        MessagesPlaceholder("history"),
        ("human", "CURRENT REQUEST:\n{query}"),
    ])



    try:
        llm = getattr(request.app.state, "llm", None)
        if llm is None or not hasattr(llm, "model"):
            raise ValueError("LLM not initialized")

        history = to_chat_messages(explain_request.history)

        chain = prompt | llm.model | StrOutputParser()
        text = chain.invoke({"query": query, "history": history})


        return {
            "mode": "explain",
            "explanation": text.strip(),
            "code": "",
            "language": explain_request.language or "",
        }


    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": f"Error while explaining: {str(e)}"},
        )
