from functools import lru_cache
from pathlib import Path


PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:

    prompt_path = PROMPTS_DIR / f"{name}.txt"

    return prompt_path.read_text(encoding="utf-8").strip()
