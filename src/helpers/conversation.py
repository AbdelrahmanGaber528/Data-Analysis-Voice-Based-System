
MAX_HISTORY_CHARS = 6000
MAX_MESSAGE_CHARS = 3000
MAX_HISTORY_MESSAGES = 20
VALID_ROLES = {"user", "assistant"}


def sanitize_history(
    history,
    max_chars: int = MAX_HISTORY_CHARS,
    max_message_chars: int = MAX_MESSAGE_CHARS,
    max_messages: int = MAX_HISTORY_MESSAGES,
):
    """Return a clean, bounded list of ``{"role", "content"}`` turns."""

    cleaned = []

    for item in history[-max_messages:]:

        if not isinstance(item, dict):
            continue

        role = str(item.get("role", "")).strip().lower()
        content = item.get("content")

        if role not in VALID_ROLES or not isinstance(content, str):
            continue

        content = content.strip()
        if not content:
            continue

        if len(content) > max_message_chars:
            content = content[:max_message_chars].rstrip() + "\n[...truncated]"

        cleaned.append({"role": role, "content": content})

    # Keep the newest turns that fit the total budget.
    kept = []
    total = 0

    for item in reversed(cleaned):
        if total + len(item["content"]) > max_chars:
            break
        kept.append(item)
        total += len(item["content"])

    kept.reverse()

    # Do not start the context with an answer whose question was dropped.
    while kept and kept[0]["role"] == "assistant":
        kept.pop(0)

    return kept


def format_history(history, **kwargs) -> str:
    """Render history as a plain-text block for prompts that expect text."""

    turns = sanitize_history(history, **kwargs)

    lines = ["CONVERSATION SO FAR (oldest to newest):"]

    for turn in turns:
        label = "USER" if turn["role"] == "user" else "ASSISTANT"
        lines.append(f"{label}: {turn['content']}")

    return "\n\n".join(lines)


def to_chat_messages(history, **kwargs):
    """Convert sanitized history into LangChain messages."""

    from langchain_core.messages import AIMessage, HumanMessage

    messages = []

    for turn in sanitize_history(history, **kwargs):
        content = turn["content"]
        messages.append(
            HumanMessage(content=content)
            if turn["role"] == "user"
            else AIMessage(content=content)
        )

    return messages
