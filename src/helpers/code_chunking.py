import re

DEFAULT_CHUNK_CHARS = 1200
DEFAULT_CHUNK_LINES = 80
DEFAULT_OVERLAP_LINES = 4
DEFAULT_TEXT_CHARS = 1500
DEFAULT_TEXT_OVERLAP = 120

FENCED_CODE_RE = re.compile(r"```[ \t]*([a-zA-Z0-9_+.#-]*)[ \t]*\r?\n(.*?)```", re.DOTALL)

TOP_LEVEL_BLOCK_RE = re.compile(
    r"^\s{0,3}(?:"
    r"(?:async\s+def|def|class)\s+[A-Za-z_]\w*"
    r"|(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$]\w*"
    r"|(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$]\w*\s*=\s*(?:async\s*)?(?:\(|function)"
    r"|(?:public|private|protected|internal)\s+(?:static\s+)?(?:class|interface|enum|record)\s+\w+"
    r"|(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>\[\]]+\s+\w+\s*\("
    r"|(?:func|fn)\s+\w+"
    r"|(?:public\s+)?(?:class|interface|enum|record)\s+\w+"
    r")"
)

CODE_LINE_RE = re.compile(
    r"^\s*(?:def|class|import|from\s+\S+\s+import|if\s+__name__|return|yield|"
    r"for|while|try|except|finally|with|elif|else:|match|case|async\s+def|async\s+for|await|"
    r"function|const|let|var|export|module\.exports|require\(|public|private|protected|static|final|void|"
    r"package|using|namespace|#include|#define|func|fn|impl|struct|enum|trait|"
    r"SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH|</?[a-zA-Z][^>]*>)\b"
)

LANGUAGE_ALIASES = {
    "py": "python", "python3": "python", "js": "javascript", "jsx": "javascript", "mjs": "javascript",
    "cjs": "javascript", "ts": "typescript", "tsx": "typescript", "sh": "bash", "shell": "bash",
    "zsh": "bash", "yml": "yaml", "c++": "cpp", "cxx": "cpp", "cs": "csharp", "golang": "go",
    "rs": "rust", "kt": "kotlin", "html5": "html",
}

LANGUAGE_PATTERNS = {
    "python": r"(?:^|\n)\s*(?:async\s+def|def|class|from\s+\S+\s+import|import)\s+",
    "typescript": r"(?:^|\n)\s*(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b",
    "javascript": r"(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+\w+|=>|const\s+\w+\s*=",
    "java": r"\b(?:public|private)\s+class\b|System\.out\.",
    "csharp": r"\busing\s+System\b|\bnamespace\s+\w+",
    "go": r"(?:^|\n)\s*(?:package\s+\w+|func\s+\w+\s*\()",
    "rust": r"(?:^|\n)\s*(?:fn\s+\w+|use\s+\w+::|impl\s+\w+)",
    "php": r"<\?php",
    "sql": r"(?i)(?:^|\n)\s*(?:select|insert|update|delete|create\s+table)\b",
    "html": r"(?i)<!doctype\s+html|<html\b",
    "bash": r"(?:^|\n)#!/usr/bin/env\s+(?:ba)?sh|(?:^|\n)\s*(?:echo|export)\s+",
}


def normalize_text(text: str):
    if not isinstance(text, str):
        return ""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip("\n")


def normalize_language(language: str | None):
    value = (language or "").strip().lower().lstrip(".")
    return LANGUAGE_ALIASES.get(value, value)


def extract_code_blocks(text: str):
    if not isinstance(text, str):
        return []
    return [{"code": code.strip(), "language": normalize_language(language)}
            for language, code in FENCED_CODE_RE.findall(text) if code.strip()]


def looks_like_code(text: str):
    
    text = text.strip() if isinstance(text, str) else ""
    lines = [line for line in text.splitlines() if line.strip()]
    
    if len(text) < 40 or len(lines) < 2:
        return False
    
    code_lines = sum(bool(CODE_LINE_RE.match(line)) for line in lines)
    
    if code_lines >= 3 and code_lines / len(lines) >= 0.35:
        return True
    
    structural = sum(bool(re.search(r"[{}();=]|^(?: {4}|\t)", line)) for line in lines)
    strong_signal = re.search(r"(?:^|\n)\s*(?:def\s+\w+\s*\(|class\s+\w+|function\s+\w+\s*\(|"
                              r"const\s+\w+\s*=|import\s+\w+|#include\s*<|package\s+\w+)", text)
    
    return bool(strong_signal and structural >= 2)




def detect_language(code: str, hint: str | None = None):
    
    hinted = normalize_language(hint)
    
    if hinted:
        return hinted
    sample = (code or "")[:4000]
    
    for language, pattern in LANGUAGE_PATTERNS.items():
        if re.search(pattern, sample):
            return language
        
    return ""




def chunk_code(code: str, max_chars: int = DEFAULT_CHUNK_CHARS, max_lines: int = DEFAULT_CHUNK_LINES, overlap_lines: int = DEFAULT_OVERLAP_LINES):
    
    text = normalize_text(code)
    lines = text.splitlines()
    
    if not lines:
        return []
    
    
    if len(text) <= max_chars and len(lines) <= max_lines:
        return [text]
    
    
    chunks, start = [], 0
    
    while start < len(lines):
        end, chars, boundary = start, 0, 0
        
        while end < len(lines):
            extra = len(lines[end]) + 1
            if end > start and (chars + extra > max_chars or end - start >= max_lines):
                break
            chars += extra
            end += 1
            
            if end < len(lines) and end - start >= 6 and TOP_LEVEL_BLOCK_RE.match(lines[end]):
                boundary = end
                
        cut = boundary or end
        chunk = "\n".join(lines[start:cut]).strip("\n")
        
        if chunk.strip():
            chunks.append(chunk)
            
        if cut >= len(lines):
            break
        
        start = max(start + 1, cut - overlap_lines)
        
        
    return chunks






def chunk_explanation(text: str, max_chars: int = DEFAULT_TEXT_CHARS, overlap_chars: int = DEFAULT_TEXT_OVERLAP):
    
    text = normalize_text(text)
    
    if not text:
        return []
    
    if len(text) <= max_chars:
        return [text]
    
    chunks, current = [], ""
    for paragraph in re.split(r"\n\s*\n", text):
        paragraph = paragraph.strip()
        
        if not paragraph:
            continue
        
        if len(paragraph) > max_chars:
            
            if current:
                chunks.append(current.strip())
                current = ""
                
            step = max(1, max_chars - overlap_chars)
            
            for start in range(0, len(paragraph), step):
                chunks.append(paragraph[start:start + max_chars].strip())
                
            continue
        
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        
        if len(candidate) > max_chars:
            
            if current:
                chunks.append(current.strip())
            current = paragraph
        else:
            current = candidate
            
    if current.strip():
        chunks.append(current.strip())
        
        
    return chunks
