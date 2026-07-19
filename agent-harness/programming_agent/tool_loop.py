"""
Explicit tool-calling loop with forced tool_choice.

create_react_agent defaults to tool_choice=auto. Small OpenAI-compatible
models (Qwen via vLLM Hermes) often reply in prose and never emit tool_calls.
This loop forces tools until a mutating edit lands, recovers Hermes/prose
stubs, and executes tools itself so GPT-4o / Claude / Qwen share one path.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Sequence, Union

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool

from programming_agent.jobs import TokenUsage
from programming_agent.prose_tools import inject_prose_tool_calls, wrap_model_for_prose_tools

logger = logging.getLogger(__name__)

MUTATING_TOOLS = frozenset({"write_file", "edit_file"})
VERIFY_BROWSER = "browser_check"
VERIFY_EVAL = "report_to_evaluator"
VERIFY_TOOLS = frozenset({VERIFY_BROWSER, VERIFY_EVAL})


@dataclass
class ToolLoopResult:
    output: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    cancelled: bool = False
    mutated: bool = False
    verified: bool = False


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


def _extract_usage(message: Any, usage: TokenUsage) -> None:
    meta = getattr(message, "usage_metadata", None) or {}
    if isinstance(meta, dict):
        prompt = int(meta.get("input_tokens") or meta.get("prompt_tokens") or 0)
        completion = int(
            meta.get("output_tokens") or meta.get("completion_tokens") or 0
        )
        if prompt or completion:
            usage.add(prompt, completion)
            return
    resp = getattr(message, "response_metadata", None) or {}
    if not isinstance(resp, dict):
        return
    token_usage = resp.get("token_usage") or resp.get("usage") or {}
    if isinstance(token_usage, dict):
        prompt = int(
            token_usage.get("prompt_tokens")
            or token_usage.get("input_tokens")
            or 0
        )
        completion = int(
            token_usage.get("completion_tokens")
            or token_usage.get("output_tokens")
            or 0
        )
        if prompt or completion:
            usage.add(prompt, completion)


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


def looks_like_website_task(text: str) -> bool:
    lower = text.lower()
    needles = (
        "website",
        "landing",
        "web page",
        "webpage",
        "homepage",
        "ui ",
        " ui",
        "frontend",
        "next.js",
        "app/page",
        "waitlist",
        "calculator",
        "dashboard",
        "form",
        "button",
        "css",
        "tailwind",
        "scaffold",
        "preview",
    )
    return any(n in lower for n in needles)


def run_tool_loop(
    *,
    model: BaseChatModel,
    tools: Sequence[BaseTool],
    system: str,
    user_message: str,
    max_turns: int = 40,
    force_tools_until_mutate: bool = True,
    prefer_write_file: bool = False,
    require_website_verification: Optional[bool] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
    on_usage: Optional[Callable[[TokenUsage], None]] = None,
) -> ToolLoopResult:
    """
    Run an OpenAI-style tool loop.

    When force_tools_until_mutate is True, the first turns use
    tool_choice=required (or write_file) until write_file/edit_file succeeds.
    When require_website_verification is True (or auto-detected), the loop also
    forces browser_check + report_to_evaluator before a final prose answer.
    """
    wrapped = wrap_model_for_prose_tools(model)
    by_name = {t.name: t for t in tools}
    can_verify = VERIFY_TOOLS.issubset(by_name)
    if require_website_verification is None:
        require_verify = can_verify and looks_like_website_task(user_message)
    else:
        require_verify = bool(require_website_verification) and can_verify

    messages: list[BaseMessage] = [
        SystemMessage(content=system),
        HumanMessage(content=user_message),
    ]

    usage = TokenUsage()
    mutated = False
    called: set[str] = set()
    summaries: list[str] = []
    forced_left = 6 if force_tools_until_mutate else 0
    verify_nudges = 4 if require_verify else 0
    cancelled = False

    for turn in range(max(1, max_turns)):
        if should_cancel and should_cancel():
            cancelled = True
            break

        verified = VERIFY_BROWSER in called and VERIFY_EVAL in called
        if force_tools_until_mutate and not mutated and forced_left > 0:
            if prefer_write_file and turn == 0 and "write_file" in by_name:
                choice: Optional[str] = "write_file"
            else:
                choice = "required"
            forced_left -= 1
        elif require_verify and mutated and not verified and verify_nudges > 0:
            if VERIFY_BROWSER not in called and VERIFY_BROWSER in by_name:
                choice = VERIFY_BROWSER
            elif VERIFY_EVAL not in called and VERIFY_EVAL in by_name:
                choice = VERIFY_EVAL
            else:
                choice = "required"
            verify_nudges -= 1
        else:
            choice = "auto"

        bound = _bind_with_choice(wrapped, tools, choice)  # type: ignore[arg-type]
        raw = bound.invoke(messages)
        if not isinstance(raw, BaseMessage):
            return ToolLoopResult(output=str(raw), usage=usage, mutated=mutated)

        _extract_usage(raw, usage)
        if on_usage:
            on_usage(usage)

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

        if (
            not tool_calls
            and require_verify
            and mutated
            and not verified
            and verify_nudges >= 0
            and choice in (VERIFY_BROWSER, VERIFY_EVAL, "required")
        ):
            missing = []
            if VERIFY_BROWSER not in called:
                missing.append(VERIFY_BROWSER)
            if VERIFY_EVAL not in called:
                missing.append(VERIFY_EVAL)
            messages.append(ai)
            messages.append(
                HumanMessage(
                    content=(
                        "Website verification incomplete. Call these tools now "
                        f"(real tool calls, not prose): {', '.join(missing)}. "
                        "Use browser_check on the preview URL, then "
                        "report_to_evaluator with goal + evidence + claim."
                    )
                )
            )
            continue

        messages.append(ai)

        if not tool_calls:
            text = _message_content(ai).strip()
            if (
                require_verify
                and mutated
                and not verified
                and verify_nudges > 0
            ):
                missing = [
                    t
                    for t in (VERIFY_BROWSER, VERIFY_EVAL)
                    if t not in called
                ]
                messages.append(
                    HumanMessage(
                        content=(
                            "Do not finish yet. Mandatory verification tools "
                            f"still missing: {', '.join(missing)}."
                        )
                    )
                )
                verify_nudges -= 1
                continue
            if text:
                summaries.append(text)
            break

        for i, call in enumerate(tool_calls):
            if should_cancel and should_cancel():
                cancelled = True
                break
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
                if name in VERIFY_TOOLS and not str(content).startswith("Error:"):
                    called.add(name)
                    # browser_check with skipped:true still counts as attempted.
                    if name == VERIFY_BROWSER and '"skipped": true' in str(
                        content
                    ).replace(" ", ""):
                        called.add(VERIFY_BROWSER)
            messages.append(
                ToolMessage(content=content, tool_call_id=call_id, name=name)
            )
        if cancelled:
            break

    verified = VERIFY_BROWSER in called and VERIFY_EVAL in called
    output = ""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            text = _message_content(msg).strip()
            if text and text != "(executing recovered tool calls)":
                output = text
                break
    if not output:
        if cancelled:
            output = "Run cancelled."
        elif mutated:
            output = "Updated workspace files via tools."
        elif summaries:
            output = summaries[-1]
        else:
            output = "Done."
    if require_verify and mutated and not verified and not cancelled:
        output = (
            f"{output}\n\n---\n"
            "Warning: finished without browser_check + report_to_evaluator. "
            "Treat the UI as unverified."
        )

    return ToolLoopResult(
        output=output,
        usage=usage,
        cancelled=cancelled,
        mutated=mutated,
        verified=verified,
    )


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
