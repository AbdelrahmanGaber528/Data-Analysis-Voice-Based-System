import json
import logging
import re

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse
from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from api.schema.generation import GenerateRequest
from helpers.code_chunking import detect_language
from helpers.code_rag import (
    finalize_code_correction,
    knowledge_stats,
    prepare_code_context,
)
from helpers.conversation import to_chat_messages
from helpers.prompts import load_prompt


logger = logging.getLogger(__name__)

generation_router = APIRouter(prefix="/api/v1", tags=["api_v1", "generate"])

MAX_GENERATION_ATTEMPTS = 2


def _load_json(text: str):
    """Best-effort JSON parsing for model responses."""

    fenced = re.search(
        r"```(?:json)?\s*(.*?)```",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    candidate = fenced.group(1).strip() if fenced else text

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    start = candidate.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(candidate)):
        char = candidate[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(candidate[start:index + 1])
                except json.JSONDecodeError:
                    return None

    return None


def _extract_string_field(text: str, field: str) -> str:
    """Extract a JSON string value even when it contains raw newlines.

    Free models sometimes put real line breaks inside the JSON string, which
    makes the whole object invalid. Scanning to the closing quote recovers the
    value without needing a second model call.
    """

    match = re.search(rf'"{re.escape(field)}"\s*:\s*"', text)

    if not match:
        return ""

    chars = []
    index = match.end()
    escaped = False

    while index < len(text):
        char = text[index]

        if escaped:
            chars.append({
                "n": "\n",
                "r": "\r",
                "t": "\t",
                '"': '"',
                "\\": "\\",
            }.get(char, char))
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            break
        else:
            chars.append(char)

        index += 1

    return "".join(chars).strip()


def _parse_generation(text: str):

    payload = _load_json(text)

    if isinstance(payload, dict):
        code = str(payload.get("code") or "").strip()
        explanation = str(payload.get("explanation") or "").strip()
        language = str(payload.get("language") or "").strip()

        if code:
            return {
                "explanation": explanation or "Here is the generated implementation.",
                "code": code,
                "language": language,
            }

    # Fallback for slightly malformed JSON containing raw line breaks.
    code = _extract_string_field(text, "code")

    if code:
        return {
            "explanation": _extract_string_field(text, "explanation") or "Here is the generated implementation.",
            "code": code,
            "language": _extract_string_field(text, "language"),
        }

    # Fallback: the model ignored the JSON instruction and used a code fence.
    fenced = re.search(
        r"```([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*?)```",
        text,
    )

    if fenced:
        code = fenced.group(2).strip()
        explanation = (text[:fenced.start()] + text[fenced.end():]).strip()

        if code:
            return {
                "explanation": explanation or "Here is the generated implementation.",
                "code": code,
                "language": fenced.group(1).strip(),
            }

    return {
        "explanation": text.strip(),
        "code": "",
        "language": "",
    }


@generation_router.get("/generate/knowledge")
def knowledge_base_stats():
    """Expose non-sensitive counters for the local code knowledge base."""

    return knowledge_stats()


@generation_router.post("/generate")
def generate_code(generate_request: GenerateRequest, request: Request):

    raw_query = (generate_request.query or "").strip()
    context = (generate_request.context or "").strip()
    code_input = (generate_request.code or "").strip()

    if not (raw_query or context or code_input):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"message": "Provide a description of the code to generate."},
        )

    # Include supplied code directly in the prompt; it is excluded from
    # retrieval, so without this block the model could not modify it.
    code_lines = []

    if code_input:
        fence_language = generate_request.language or ""
        code_lines.append(f"CODE TO MODIFY:\n```{fence_language}\n{code_input}\n```")

    base_request = "\n\n".join(
        part for part in (raw_query or context, *code_lines) if part
    ).strip() or "Generate or improve the provided code."

    details = []

    if generate_request.language:
        details.append(f"LANGUAGE: {generate_request.language}")

    if context:
        details.append(f"CONTEXT: {context}")

    llm = getattr(request.app.state, "llm", None)
    knowledge = prepare_code_context(
        query=raw_query or base_request,
        code=code_input,
        context=context,
        language=generate_request.language or "",
        history=generate_request.history,
        conversation_id=generate_request.conversation_id or "",
        correction=generate_request.correction,
        llm=llm,
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
        SystemMessage(content=load_prompt("generation")),
        MessagesPlaceholder("history"),
        ("human", "CURRENT REQUEST:\n{query}"),
    ])

    try:
        if llm is None or not hasattr(llm, "model"):
            raise ValueError("LLM not initialized")

        history = to_chat_messages(generate_request.history)
        chain = prompt | llm.model | StrOutputParser()

        result = None

        for attempt in range(1, MAX_GENERATION_ATTEMPTS + 1):
            text = chain.invoke({"query": query, "history": history})
            parsed = _parse_generation(text or "")

            if parsed["code"]:
                result = parsed
                break

            logger.warning(
                "Generation attempt %s/%s returned no code: %s",
                attempt,
                MAX_GENERATION_ATTEMPTS,
                (text or "")[:300].replace("\n", " "),
            )

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_502_BAD_GATEWAY,
                content={"message": "The model did not return usable code. Please try again."},
            )

        language = (
            result.get("language")
            or generate_request.language
            or detect_language(result.get("code", ""))
        )

        if knowledge.get("correction"):
            finalize_code_correction(
                code=result.get("code", ""),
                explanation=result.get("explanation", ""),
                language=language,
                conversation_id=generate_request.conversation_id or "",
            )

        return {
            "mode": "generate",
            **result,
        }

    except Exception as e:
        logger.error("Error while generating code: %s", e)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": f"Error while generating code: {str(e)}"},
        )
