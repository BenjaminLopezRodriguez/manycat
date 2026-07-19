"""
Recover tool calls when weak OpenAI-compatible models dump JSON tool stubs
in prose instead of emitting native `tool_calls` (common with vLLM + Qwen).
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.tools import BaseTool

KNOWN_TOOLS = frozenset(
    {
        "read_file",
        "write_file",
        "edit_file",
        "glob",
        "grep",
        "bash",
        "browser_check",
        "read_app_logs",
        "report_to_evaluator",
        "todo_write",
        "task",
    }
)

# Fenced ```json { "name": "edit_file", "arguments": {...} } ```
_FENCED = re.compile(
    r"```(?:json)?\s*(\{[\s\S]*?\})\s*```",
    re.IGNORECASE,
)

# Hermes / vLLM XML tool calls (when not parsed into native tool_calls)
_HERMES_TOOL_CALL = re.compile(
    r"<tool_call>\s*(\{[\s\S]*?\})\s*</tool_call>",
    re.IGNORECASE,
)

# Fenced TSX/JSX the model "wrote" in chat instead of calling write_file
_FENCED_CODE = re.compile(
    r"```(?:tsx|typescript|jsx|javascript)?\s*\n([\s\S]*?)```",
    re.IGNORECASE,
)

# Bare object with a known tool name (non-greedy enough for nested braces via decoder)
_NAME_HINT = re.compile(
    r'\{\s*"name"\s*:\s*"(?P<name>' + "|".join(KNOWN_TOOLS) + r')"\s*,',
)


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(parts)
    return str(content or "")


def _normalize_call(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Map common model mistakes onto our tool schemas / names."""
    out = dict(args)
    if name == "write_file":
        if "contents" in out and "content" not in out:
            out["content"] = out.pop("contents")
        if "new_string" in out and "content" not in out:
            out["content"] = out.pop("new_string")
        return {"name": name, "args": out}

    if name == "edit_file":
        if "content" in out and "new_string" not in out:
            out["new_string"] = out.pop("content")
        old = out.get("old_string")
        new = out.get("new_string")
        # Full-page rewrites via edit_file with missing/wrong old_string → write_file.
        if isinstance(new, str) and len(new) >= 40 and (
            not isinstance(old, str)
            or not old.strip()
            or len(new) > max(len(old) * 2, 120)
        ):
            path = out.get("path")
            return {
                "name": "write_file",
                "args": {"path": path, "content": new},
            }
        return {"name": name, "args": out}

    return {"name": name, "args": out}


def _try_parse_tool_obj(raw: str) -> Optional[dict[str, Any]]:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    name = obj.get("name") or obj.get("tool") or obj.get("function")
    if not isinstance(name, str) or name not in KNOWN_TOOLS:
        return None
    args = obj.get("arguments") or obj.get("args") or obj.get("parameters") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            return None
    if not isinstance(args, dict):
        return None
    return _normalize_call(name, args)


def _extract_balanced_object(text: str, start: int) -> Optional[str]:
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _looks_like_react_page(code: str) -> bool:
    lowered = code.lower()
    return (
        "export default" in lowered
        or "function homepage" in lowered
        or "usestate" in lowered
        or "<main" in lowered
    ) and len(code.strip()) >= 80


def extract_prose_tool_calls(content: Any) -> list[dict[str, Any]]:
    """Return OpenAI-style tool_call dicts parsed from assistant prose."""
    text = _message_text(content)
    if not text.strip():
        return []

    found: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(parsed: dict[str, Any]) -> None:
        key = json.dumps(parsed, sort_keys=True)
        if key in seen:
            return
        seen.add(key)
        found.append(
            {
                "name": parsed["name"],
                "args": parsed["args"],
                "id": f"prose_{uuid.uuid4().hex[:10]}",
                "type": "tool_call",
            }
        )

    for match in _HERMES_TOOL_CALL.finditer(text):
        parsed = _try_parse_tool_obj(match.group(1))
        if parsed:
            add(parsed)

    for match in _FENCED.finditer(text):
        parsed = _try_parse_tool_obj(match.group(1))
        if parsed:
            add(parsed)

    for match in _NAME_HINT.finditer(text):
        blob = _extract_balanced_object(text, match.start())
        if not blob:
            continue
        parsed = _try_parse_tool_obj(blob)
        if parsed:
            add(parsed)

    # Last resort: model dumped a full page as a code fence — treat as write_file.
    if not any(c["name"] == "write_file" for c in found):
        for match in _FENCED_CODE.finditer(text):
            code = match.group(1).strip()
            if not _looks_like_react_page(code):
                continue
            path = "app/page.tsx"
            path_hint = re.search(
                r"(?:write_file|file|path)[:\s`]+([^\s`]+\.tsx)",
                text[: match.start()],
                re.IGNORECASE,
            )
            if path_hint:
                path = path_hint.group(1).lstrip("./")
            add(
                {
                    "name": "write_file",
                    "args": {"path": path, "content": code},
                }
            )
            break

    return found


def inject_prose_tool_calls(message: BaseMessage) -> BaseMessage:
    """If an AIMessage has no native tool_calls, lift JSON stubs into tool_calls."""
    if not isinstance(message, AIMessage):
        return message
    existing = getattr(message, "tool_calls", None) or []
    if existing:
        return message
    calls = extract_prose_tool_calls(message.content)
    if not calls:
        return message
    return AIMessage(
        content="(executing recovered tool calls)",
        tool_calls=calls,
        id=getattr(message, "id", None),
        additional_kwargs=dict(getattr(message, "additional_kwargs", {}) or {}),
        response_metadata=dict(getattr(message, "response_metadata", {}) or {}),
    )


class ProseToolCallModel(Runnable[Any, BaseMessage]):
    """
    Chat-model wrapper: after each generation, convert prose JSON tool stubs
    into native tool_calls so LangGraph's ReAct tool node can run them.
    """

    def __init__(self, model: Runnable) -> None:
        self.model = model

    def bind_tools(
        self,
        tools: list[BaseTool],
        **kwargs: Any,
    ) -> "ProseToolCallModel":
        # Forward tool_choice (required / write_file / auto) to the provider.
        bound = self.model.bind_tools(tools, **kwargs)  # type: ignore[attr-defined]
        return ProseToolCallModel(bound)

    def bind(self, **kwargs: Any) -> "ProseToolCallModel":
        bound = self.model.bind(**kwargs)  # type: ignore[attr-defined]
        return ProseToolCallModel(bound)

    def with_config(self, *args: Any, **kwargs: Any) -> "ProseToolCallModel":
        return ProseToolCallModel(self.model.with_config(*args, **kwargs))

    def invoke(
        self,
        input: Any,
        config: Optional[RunnableConfig] = None,
        **kwargs: Any,
    ) -> BaseMessage:
        result = self.model.invoke(input, config=config, **kwargs)
        if isinstance(result, BaseMessage):
            return inject_prose_tool_calls(result)
        return result

    async def ainvoke(
        self,
        input: Any,
        config: Optional[RunnableConfig] = None,
        **kwargs: Any,
    ) -> BaseMessage:
        result = await self.model.ainvoke(input, config=config, **kwargs)
        if isinstance(result, BaseMessage):
            return inject_prose_tool_calls(result)
        return result


def wrap_model_for_prose_tools(model: BaseChatModel) -> ProseToolCallModel:
    return ProseToolCallModel(model)
