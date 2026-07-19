"""
Explicit tool-calling loop with forced tool_choice.

create_react_agent defaults to tool_choice=auto. Small OpenAI-compatible
models (Qwen via vLLM Hermes) often reply in prose and never emit tool_calls.
This loop forces tools until a mutating edit lands, recovers Hermes/prose
stubs, and executes tools itself so GPT-4o / Claude / Qwen share one path.
"""

from __future__ import annotations

import logging
from typing import Any, Optional, Sequence, Union

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool

from programming_agent.prose_tools import inject_prose_tool_calls, wrap_model_for_prose_tools

logger = logging.getLogger(__name__)

MUTATING_TOOLS = frozenset({"write_file", "edit_file"})


def _tool_name(call: Any) -> str:
    if isinstance(call, dict):
        return str(call.get("name") or "")
    return str(getattr(call, "name", "") or "")


def _tool_args(call: Any) -> dict[str, Any]:
    if isinstance(call, dict):
        args = call.get("args") or call.get("arguments") or {}
        return args if isinstance(args, dict) else {}
    args = getattr(call, "args", None) or {}
    return args if isinstance(args, dict) else {}


def _tool_id(call: Any, index: int) -> str:
    if isinstance(call, dict):
        return str(call.get("id") or f"call_{index}")
    return str(getattr(call, "id", None) or f"call_{index}")


def _bind_with_choice(
    model: BaseChatModel,
    tools: Sequence[BaseTool],
    choice: Optional[str],
) -> Any:
    """Bind tools; prefer required/named choice, degrade gracefully."""
    if choice is None or choice == "auto":
        return model.bind_tools(list(tools))
    try:
        return model.bind_tools(list(tools), tool_choice=choice)
    except Exception as exc:  # noqa: BLE001 — provider-specific kwargs
        logger.warning("tool_choice=%s unsupported (%s); falling back", choice, exc)
        if choice not in ("required", "any"):
            try:
                return model.bind_tools(list(tools), tool_choice="required")
            except Exception:  # noqa: BLE001
                pass
        return model.bind_tools(list(tools))


def _invoke_tool(tool: BaseTool, args: dict[str, Any]) -> str:
    try:
        result = tool.invoke(args)
    except Exception as exc:  # noqa: BLE001 — surface to model
        return f"Error: {exc}"
    if result is None:
        return "ok"
    return result if isinstance(result, str) else str(result)


def run_tool_loop(
    *,
    model: BaseChatModel,
    tools: Sequence[BaseTool],
    system: str,
    user_message: str,
    max_turns: int = 40,
    force_tools_until_mutate: bool = True,
    prefer_write_file: bool = False,
) -> str:
    """
    Run an OpenAI-style tool loop.

    When force_tools_until_mutate is True, the first turns use
    tool_choice=required (or write_file) until write_file/edit_file succeeds.
    """
    wrapped = wrap_model_for_prose_tools(model)
    by_name = {t.name: t for t in tools}
    messages: list[BaseMessage] = [
        SystemMessage(content=system),
        HumanMessage(content=user_message),
    ]

    mutated = False
    summaries: list[str] = []
    forced_left = 6 if force_tools_until_mutate else 0

    for turn in range(max(1, max_turns)):
        if force_tools_until_mutate and not mutated and forced_left > 0:
            if prefer_write_file and turn == 0 and "write_file" in by_name:
                choice: Optional[str] = "write_file"
            else:
                choice = "required"
            forced_left -= 1
        else:
            choice = "auto"

        bound = _bind_with_choice(wrapped, tools, choice)  # type: ignore[arg-type]
        raw = bound.invoke(messages)
        if not isinstance(raw, BaseMessage):
            return str(raw)

        ai = inject_prose_tool_calls(raw)
        if not isinstance(ai, AIMessage):
            ai = AIMessage(content=_message_content(raw))

        tool_calls = list(getattr(ai, "tool_calls", None) or [])

        # If provider ignored required and returned prose only, nudge once.
        if not tool_calls and choice in ("required", "write_file") and forced_left >= 0:
            messages.append(ai)
            messages.append(
                HumanMessage(
                    content=(
                        "You must call a tool now. Use write_file on app/page.tsx "
                        "with the full file contents for the user request. Do not "
                        "reply with JSON in prose — emit a real tool call."
                    )
                )
            )
            continue

        messages.append(ai)

        if not tool_calls:
            text = _message_content(ai).strip()
            if text:
                summaries.append(text)
            break

        for i, call in enumerate(tool_calls):
            name = _tool_name(call)
            args = _tool_args(call)
            call_id = _tool_id(call, i)
            tool = by_name.get(name)
            if tool is None:
                content = f"Error: unknown tool {name!r}"
            else:
                content = _invoke_tool(tool, args)
                if name in MUTATING_TOOLS and not content.startswith("Error:"):
                    mutated = True
            messages.append(
                ToolMessage(content=content, tool_call_id=call_id, name=name)
            )

    # Final text: last non-empty AI content, or a short default.
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            text = _message_content(msg).strip()
            if text and text != "(executing recovered tool calls)":
                return text
    if mutated:
        return "Updated workspace files via tools."
    if summaries:
        return summaries[-1]
    return "Done."


def _message_content(message: Union[BaseMessage, Any]) -> str:
    content = getattr(message, "content", message)
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
