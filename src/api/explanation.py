import logging

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse
from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from api.schema.explanation import ExplainRequest
from helpers.code_rag import finalize_code_correction, prepare_code_context
from helpers.conversation import to_chat_messages
from helpers.prompts import load_prompt


logger = logging.getLogger(__name__)

explain_router = APIRouter(prefix="/api/v1", tags=["api_v1", "explain"])


@explain_router.post("/explain")
def explain_code(explain_request: ExplainRequest, request: Request):

    raw_query = (explain_request.query or explain_request.question or "").strip()
    code_input = (explain_request.code or "").strip()
    context = (explain_request.context or "").strip()

    if not raw_query and not code_input:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"message": "Provide code or question to explain."},
        )

    # Always place submitted code in the prompt. It must not rely on retrieval:
    # the retriever may return a related snippet, but the current code is the
    # subject the model has to explain.
    code_lines = []

    if code_input:
        fence_language = explain_request.language or ""
        code_lines.append(f"CODE TO EXPLAIN:\n```{fence_language}\n{code_input}\n```")

    base_request = "\n\n".join(
        part for part in (raw_query, *code_lines) if part
    ).strip()

    details = []

    if explain_request.language:
        details.append(f"LANGUAGE: {explain_request.language}")

    if context:
        details.append(f"CONTEXT: {context}")

    knowledge = prepare_code_context(
        query=raw_query or base_request,
        code=code_input,
        context=context,
        language=explain_request.language or "",
        history=explain_request.history,
        conversation_id=explain_request.conversation_id or "",
        correction=explain_request.correction,
    )

    query_parts = []

    if details:
        query_parts.append("\n".join(details))

    if knowledge.get("correction_text"):
        query_parts.append(knowledge["correction_text"])

    if knowledge.get("context_text"):
        query_parts.append(knowledge["context_text"])

    query_parts.append(base_request)
    query = "\n\n".join(query_parts)

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
        explanation = (text or "").strip()

        if knowledge.get("correction"):
            finalize_code_correction(
                code=code_input,
                explanation=explanation,
                language=explain_request.language or "",
                conversation_id=explain_request.conversation_id or "",
            )

        return {
            "mode": "explain",
            "explanation": explanation,
            "code": "",
            "language": explain_request.language or "",
        }

    except Exception as e:
        logger.error("Error while explaining code: %s", e)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": f"Error while explaining: {str(e)}"},
        )
