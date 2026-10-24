import json
import logging
import re
from functools import lru_cache
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from helpers.code_chunking import extract_code_blocks, looks_like_code, normalize_text
from helpers.code_vector_store import CodeVectorStore
from helpers.config import SRC_DIR, get_settings
from helpers.corrections import is_correction_request
from helpers.prompts import load_prompt

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_code_vector_store():
    settings = get_settings()
    path = Path(settings.VECTOR_DB_DIR).expanduser()
    return CodeVectorStore(
        path=path if path.is_absolute() else SRC_DIR / path,
        top_k=settings.RAG_TOP_K, min_score=settings.RAG_MIN_SCORE,
        max_context_chars=settings.RAG_MAX_CONTEXT_CHARS,
        chunk_chars=settings.CODE_CHUNK_SIZE, chunk_lines=settings.CODE_CHUNK_LINES,
        overlap_lines=settings.CODE_CHUNK_OVERLAP,
    )


def _collect_code_blocks(query: str, code: str, context: str):
    blocks = [{"code": code, "language": ""}] if code.strip() else []
    for source in (query, context):
        blocks.extend(extract_code_blocks(source))
    if not blocks and looks_like_code(query):
        blocks.append({"code": query, "language": ""})
    if not blocks and looks_like_code(context):
        blocks.append({"code": context, "language": ""})
    unique = {}
    for block in blocks:
        text = (block.get("code") or "").strip()
        if text:
            unique.setdefault(normalize_text(text),
                              {"code": text, "language": block.get("language") or ""})
    return list(unique.values())


def _json_payload(text: str):
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    try:
        return json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        return {}


def _evaluate_context(query: str, results: list[dict], llm):
    if not results or not hasattr(llm, "model"):
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


def prepare_code_context(*, query: str, code: str = "", context: str = "",
                         language: str = "", history=None, conversation_id: str = "",
                         correction: bool = False, llm=None):
    is_correction = is_correction_request(query, history or [], explicit=correction)
    store = get_code_vector_store()
    blocks = _collect_code_blocks(query, code, context)
    for block in blocks:
        store.ingest_code(block["code"], language=block["language"] or language,
                          conversation_id=conversation_id)
    search_text = "\n\n".join(part for part in (query, code) if part).strip()[:4000]
    retrieved = store.search(search_text,
                             exclude_texts={normalize_text(block["code"]) for block in blocks})
    selected = _evaluate_context(search_text, retrieved, llm)
    return {
        "correction": is_correction,
        "correction_text": load_prompt("correction") if is_correction else "",
        "retrieved": selected,
        "context_text": store.format_context(selected),
    }


def finalize_code_correction(*, code: str = "", explanation: str = "", language: str = "",
                             conversation_id: str = ""):
    return get_code_vector_store().record_correction(
        code=code, explanation=explanation, language=language,
        conversation_id=conversation_id,
    )


def knowledge_stats():
    return get_code_vector_store().stats()
