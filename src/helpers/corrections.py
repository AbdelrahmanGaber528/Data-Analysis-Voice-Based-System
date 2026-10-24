import re

from helpers.conversation import sanitize_history

CORRECTION_PATTERNS = [
    r"\b(?:that|this|your|the)\s+(?:code|answer|explanation|result|solution|implementation)\s+(?:is|was|seems|looks)?\s*(?:wrong|incorrect|not\s+(?:right|correct)|incomplete|broken)\b",
    r"\b(?:you(?:'re| are)|that's|that\s+is|this\s+is|it\s+is|it's)\s+(?:wrong|incorrect|not\s+right|not\s+correct|not\s+working|broken|failing)\b",
    r"\b(?:fix|correct|update|change|rewrite)\s+(?:your|the|this|that)\s+(?:code|answer|explanation|solution|implementation)\b",
    r"\b(?:it|this|that|the\s+(?:code|function|answer|explanation|solution))\s+(?:gives?|throws?|causes?|returns?|shows?)\s+(?:me\s+)?(?:an?\s+)?(?:error|exception|bug|failure|traceback)\b",
    r"\b(?:doesn't|does\s+not|didn't|did\s+not|won't|will\s+not|isn't|is\s+not)\s+(?:work|working|run|compile|return|function)\b",
    r"\b(?:this|that|the|your)\s+(?:code|function|answer|explanation|solution)\s+(?:is|was|seems|looks)?\s*(?:not\s+working|broken|failing|fails)\b",
    r"\b(?:the\s+)?(?:function|implementation|solution|code)\s+should\s+(?:return|use|be|do|not)\b",
    r"\b(?:the|your)\s+(?:code|answer|explanation|solution)\s+(?:should|must|needs?\s+to)\s+(?:be|use|return|do|not)\b",
    r"\byou\s+(?:missed|forgot|misunderstood|got\s+.{0,40}\s+wrong)\b",
    r"\bnot\s+what\s+(?:i|we)\s+(?:asked|wanted|meant)\b",
    r"\bthere(?:'s| is)\s+(?:a|an)?\s*(?:mistake|error|bug)\s+in\s+(?:your|the)\s+(?:code|answer|explanation)\b",
    r"\b(?:actually|instead)\b[^.\n]{0,80}\b(?:should|correct|right|wrong|use|return)\b",
    r"(?:الكود|الإجابة|الاجابة|الشرح|النتيجة|الحل)\s*(?:ده|دا|هذا|هذه)?\s*(?:غلط|خطأ|خطا|غير\s+صحيح|مش\s+صح|ليس\s+صحيح)",
    r"(?:صحح|عدل|عدّل|صلح|غير)\s*(?:الكود|الإجابة|الاجابة|الشرح|النتيجة|الحل)",
    r"(?:نسيت|فاتك|أنت\s+غلط|انت\s+غلط|كلامك\s+غلط)",
    r"(?:فيه|في|بيطلع|يطلع|بيظهر|يظهر|يعطي|بيدي|بيمسك)\s*(?:خطأ|خطا|ايرور|error)",
    r"(?:مش|ما|لا)\s*(?:شغال|شغالة|يعمل|بيشتغل|يشتغل|راضي\s+يشتغل)",
    r"(?:المفروض|الصح|الصحيح)\s*(?:إنه|انه|هو|يكون|أن|ان)?",
    r"^(?:لا|لأ|غلط|خطأ|خطا|مش\s+صح|غير\s+صحيح)[\s.!؟]*$",
]

_CORRECTION_RE = re.compile("|".join(f"(?:{p})" for p in CORRECTION_PATTERNS), re.IGNORECASE)


def is_correction_request(query: str, history, explicit: bool = False):
    
    if explicit:
        return True
    
    query = (query or "").strip()
    
    previous_answer = next((turn["content"] for turn in reversed(sanitize_history(history or []))
                            if turn["role"] == "assistant"), "")
    
    
    return bool(query and previous_answer and _CORRECTION_RE.search(query[:2000]))
