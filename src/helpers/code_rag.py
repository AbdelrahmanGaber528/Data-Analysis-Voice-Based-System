from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from helpers.code_chunking import extract_code_blocks, looks_like_code, normalize_text
from helpers.code_vector_store import CodeVectorStore
from helpers.config import SRC_DIR, get_settings
from helpers.corrections import is_correction_request
from helpers.prompts import load_prompt


logger = logging.getLogger(__name__)

_store: CodeVectorStore | None = None
_store_lock = threading.Lock()


def resolve_store_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else SRC_DIR / path


def get_code_vector_store() -> CodeVectorStore:
    """Return the required shared store, initializing it on first use."""

    global _store

    if _store is None:
        with _store_lock:
            if _store is None:
                settings = get_settings()
                _store = CodeVectorStore(
                    path=resolve_store_path(settings.VECTOR_DB_DIR),
                    top_k=settings.RAG_TOP_K,
                    min_score=settings.RAG_MIN_SCORE,
                    max_context_chars=settings.RAG_MAX_CONTEXT_CHARS,
                    chunk_chars=settings.CODE_CHUNK_SIZE,
                    chunk_lines=settings.CODE_CHUNK_LINES,
                    overlap_lines=settings.CODE_CHUNK_OVERLAP,
                )

    return _store


def _collect_code_blocks(query: str, code: str, context: str) -> list[dict]:
    """Extract explicit and fenced code, keeping the first copy of each text."""

    candidates = []

    if code.strip():
        candidates.append({"code": code, "language": ""})

    for source in (query, context):
        candidates.extend(extract_code_blocks(source))

    if not candidates and looks_like_code(query):
        candidates.append({"code": query, "language": ""})

    if not candidates and looks_like_code(context):
        candidates.append({"code": context, "language": ""})

    unique = {}

    for candidate in candidates:
        text = (candidate.get("code") or "").strip()

        if text:
            unique.setdefault(normalize_text(text), {
                "code": text,
                "language": candidate.get("language") or "",
            })

    return list(unique.values())


def _json_payload(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.DOTALL)

    if not match:
        return {}

    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}


def _evaluate_context(query: str, results: list[dict], llm) -> list[dict]:
    """Ask the LLM to select the single best retrieved snippet."""

    if not results or llm is None or not hasattr(llm, "model"):
        return results[:1]

    candidates = "\n\n".join(
        f"[{index}] language={item['language']} source={item['source_type']}"
        f" score={item['score']:.2f}\n{item['content']}"
        for index, item in enumerate(results, 1)
    )
    messages = [
        SystemMessage(content=load_prompt("evaluator")),
        HumanMessage(content=f"USER REQUEST:\n{query[:2000]}\n\nCANDIDATES:\n{candidates}"),
    ]

    try:
        answer = llm.model.invoke(messages).content or ""
        best = int(_json_payload(answer).get("best", 1))
    except Exception as error:
        logger.warning("Code evaluator failed, using the top result: %s", error)
        return results[:1]

    if best <= 0:
        return []

    return [results[best - 1]] if best <= len(results) else results[:1]


def prepare_code_context(
    *,
    query: str,
    code: str = "",
    context: str = "",
    language: str = "",
    history=None,
    conversation_id: str = "",
    correction: bool = False,
    llm=None,
) -> dict:
    """Store new code, retrieve related snippets, and let the LLM pick the best."""

    is_correction = is_correction_request(query, history or [], explicit=correction)
    store = get_code_vector_store()
    blocks = _collect_code_blocks(query=query, code=code, context=context)

    for block in blocks:
        store.ingest_code(
            block["code"],
            language=block.get("language") or language,
            conversation_id=conversation_id,
        )

    search_text = "\n\n".join(part for part in (query, code) if part).strip()[:4000]
    retrieved = store.search(
        search_text,
        exclude_texts={normalize_text(block["code"]) for block in blocks},
    )
    selected = _evaluate_context(search_text, retrieved, llm)

    return {
        "correction": is_correction,
        "correction_text": load_prompt("correction") if is_correction else "",
        "retrieved": selected,
        "context_text": store.format_context(selected),
    }


def finalize_code_correction(
    *,
    code: str = "",
    explanation: str = "",
    language: str = "",
    conversation_id: str = "",
) -> dict:
    """Store the corrected answer after the model responds."""

    return get_code_vector_store().record_correction(
        code=code,
        explanation=explanation,
        language=language,
        conversation_id=conversation_id,
    )


def knowledge_stats() -> dict:
    return get_code_vector_store().stats()
