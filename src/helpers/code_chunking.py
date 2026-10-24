from __future__ import annotations

import re


DEFAULT_CHUNK_CHARS = 1200
DEFAULT_CHUNK_LINES = 80
DEFAULT_OVERLAP_LINES = 4
DEFAULT_TEXT_CHARS = 1500
DEFAULT_TEXT_OVERLAP = 120

FENCED_CODE_RE = re.compile(
    r"```[ \t]*([a-zA-Z0-9_+.#-]*)[ \t]*\r?\n(.*?)```",
    re.DOTALL,
)

TOP_LEVEL_BLOCK_RE = re.compile(
    r"^\s{0,3}(?:"
    r"(?:async\s+def|def|class)\s+[A-Za-z_]\w*"
    r"|(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$]\w*"
    r"|(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$]\w*\s*=\s*(?:async\s*)?(?:\(|function)"
    r"|(?:public|private|protected|internal)\s+(?:static\s+)?(?:class|interface|enum|record)\s+\w+"
    r"|(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>\[\]]+\s+\w+\s*\("
    r"|func\s+\w+"
    r"|fn\s+\w+"
    r"|(?:public\s+)?(?:class|interface|enum|record)\s+\w+"
    r")"
)

CODE_LINE_RE = re.compile(
    r"^\s*(?:"
    r"def|class|import|from\s+\S+\s+import|if\s+__name__|return|yield|"
    r"for|while|try|except|finally|with|elif|else:|match|case|"
    r"async\s+def|async\s+for|await|"
    r"function|const|let|var|export|module\.exports|require\(|"
    r"public|private|protected|static|final|void|"
    r"package|using|namespace|#include|#define|"
    r"func|fn|impl|struct|enum|trait|"
    r"SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH|"
    r"</?[a-zA-Z][^>]*>"
    r")\b"
)

LANGUAGE_ALIASES = {
    "py": "python",
    "python3": "python",
    "js": "javascript",
    "jsx": "javascript",
    "mjs": "javascript",
    "cjs": "javascript",
    "ts": "typescript",
    "tsx": "typescript",
    "sh": "bash",
    "shell": "bash",
    "zsh": "bash",
    "yml": "yaml",
    "c++": "cpp",
    "cxx": "cpp",
    "cs": "csharp",
    "golang": "go",
    "rs": "rust",
    "kt": "kotlin",
    "html5": "html",
}


def normalize_text(text: str) -> str:
    """Normalize line endings without changing code indentation or blank lines."""

    if not isinstance(text, str):
        return ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]

    # Strip blank lines at the edges only; internal formatting is meaningful.
    return "\n".join(lines).strip("\n")


def normalize_language(language: str | None) -> str:
    value = (language or "").strip().lower().lstrip(".")
    if not value:
        return ""
    return LANGUAGE_ALIASES.get(value, value)


def extract_code_blocks(text: str) -> list[dict]:
    """Return fenced code blocks found in a message."""

    if not isinstance(text, str):
        return []

    blocks = []

    for match in FENCED_CODE_RE.finditer(text):
        code = match.group(2).strip()

        if code:
            blocks.append({
                "code": code,
                "language": normalize_language(match.group(1)),
            })

    return blocks


def looks_like_code(text: str) -> bool:
    """Conservative heuristic for raw pasted code without a fence.

    A normal English or Arabic sentence that happens to contain the word
    "return" should not be stored as code, so this requires several code-like
    lines or a strong structural signal.
    """

    if not isinstance(text, str):
        return False

    text = text.strip()

    if len(text) < 40:
        return False

    lines = [line for line in text.splitlines() if line.strip()]

    if len(lines) < 2:
        return False

    code_lines = sum(1 for line in lines if CODE_LINE_RE.match(line))
    structural = sum(
        1 for line in lines
        if re.search(r"[{}();=]", line) or line.startswith(("    ", "\t"))
    )
    strong_signal = bool(re.search(
        r"(?:^|\n)\s*(?:def\s+\w+\s*\(|class\s+\w+|function\s+\w+\s*\(|"
        r"const\s+\w+\s*=|import\s+\w+|#include\s*<|package\s+\w+)",
        text,
    ))

    ratio = code_lines / len(lines)

    if code_lines >= 3 and ratio >= 0.35:
        return True

    if strong_signal and structural >= 2:
        return True

    return False


def detect_language(code: str, hint: str | None = None) -> str:
    """Infer a language from a hint or common syntax signals."""

    hinted = normalize_language(hint)
    if hinted:
        return hinted

    sample = (code or "")[:4000]

    patterns = [
        ("python", r"(?:^|\n)\s*(?:async\s+def|def|class|from\s+\S+\s+import|import)\s+"),
        ("typescript", r"(?:^|\n)\s*(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b"),
        ("javascript", r"(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+\w+|=>|const\s+\w+\s*="),
        ("java", r"\b(?:public|private)\s+class\b|System\.out\."),
        ("csharp", r"\busing\s+System\b|\bnamespace\s+\w+"),
        ("go", r"(?:^|\n)\s*(?:package\s+\w+|func\s+\w+\s*\()"),
        ("rust", r"(?:^|\n)\s*(?:fn\s+\w+|use\s+\w+::|impl\s+\w+)"),
        ("php", r"<\?php"),
        ("sql", r"(?i)(?:^|\n)\s*(?:select|insert|update|delete|create\s+table)\b"),
        ("html", r"(?i)<!doctype\s+html|<html\b"),
        ("bash", r"(?:^|\n)#!/usr/bin/env\s+(?:ba)?sh|(?:^|\n)\s*(?:echo|export)\s+"),
    ]

    for language, pattern in patterns:
        if re.search(pattern, sample):
            return language

    return ""


def chunk_code(
    code: str,
    max_chars: int = DEFAULT_CHUNK_CHARS,
    max_lines: int = DEFAULT_CHUNK_LINES,
    overlap_lines: int = DEFAULT_OVERLAP_LINES,
) -> list[str]:
    """Split code into overlapping chunks, preferring definition boundaries."""

    text = normalize_text(code)

    if not text:
        return []

    lines = text.splitlines()

    if len(text) <= max_chars and len(lines) <= max_lines:
        return [text]

    chunks = []
    start = 0
    total = len(lines)

    while start < total:

        end = start
        chars = 0
        boundary = None

        while end < total:

            extra = len(lines[end]) + 1

            if end > start and (chars + extra > max_chars or end - start >= max_lines):
                break

            chars += extra
            end += 1

            if end < total and TOP_LEVEL_BLOCK_RE.match(lines[end]) and end - start >= 6:
                boundary = end

        if end == start:
            end += 1

        cut = boundary if boundary and boundary > start else end
        chunk = "\n".join(lines[start:cut]).strip("\n")

        if chunk.strip():
            chunks.append(chunk)

        if cut >= total:
            break

        next_start = max(start + 1, cut - overlap_lines)
        start = next_start

    return chunks


def chunk_explanation(
    text: str,
    max_chars: int = DEFAULT_TEXT_CHARS,
    overlap_chars: int = DEFAULT_TEXT_OVERLAP,
) -> list[str]:
    """Split natural-language explanations into paragraph-aware chunks."""

    text = normalize_text(text)

    if not text:
        return []

    if len(text) <= max_chars:
        return [text]

    paragraphs = re.split(r"\n\s*\n", text)
    chunks = []
    current = ""

    for paragraph in paragraphs:

        paragraph = paragraph.strip()

        if not paragraph:
            continue

        if len(paragraph) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""

            start = 0

            while start < len(paragraph):
                end = min(start + max_chars, len(paragraph))
                chunks.append(paragraph[start:end].strip())
                start = max(end - overlap_chars, start + 1)

            continue

        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph

        if len(candidate) > max_chars:
            if current:
                chunks.append(current.strip())
            current = paragraph
        else:
            current = candidate

    if current.strip():
        chunks.append(current.strip())

    return chunks
