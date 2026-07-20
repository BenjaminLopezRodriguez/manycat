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
from programming_agent.prose_tools import (
    extract_prose_tool_calls,
    inject_prose_tool_calls,
    wrap_model_for_prose_tools,
)

logger = logging.getLogger(__name__)

MUTATING_TOOLS = frozenset({"write_file", "edit_file"})
VERIFY_BROWSER = "browser_check"
VERIFY_EVAL = "report_to_evaluator"
VERIFY_TOOLS = frozenset({VERIFY_BROWSER, VERIFY_EVAL})
BUILD_PROBE = "build_probe"
DEPLOY_EVAL = "report_deploy_to_evaluator"
DEPLOY_VERIFY_TOOLS = frozenset({BUILD_PROBE, DEPLOY_EVAL})

# Runs once after first successful mutate, before browser_check / build_probe nudges.
CHEAP_VERIFY_CMD = (
    "if [ -f package.json ]; then "
    "(npx --yes tsc --noEmit -p . 2>&1 || npm run build --if-present 2>&1 || true) "
    "| head -80; "
    "else echo 'cheap_verify: no package.json'; fi"
)


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
    require_build_probe: bool = False,
    should_cancel: Optional[Callable[[], bool]] = None,
    on_usage: Optional[Callable[[TokenUsage], None]] = None,
) -> ToolLoopResult:
    """
    Run an OpenAI-style tool loop.

    When force_tools_until_mutate is True, the first turns use
    tool_choice=required (or write_file) until write_file/edit_file succeeds.
    When require_website_verification is True (or auto-detected), the loop also
    forces browser_check + report_to_evaluator before a final prose answer.
    When require_build_probe is True, forces build_probe + report_deploy_to_evaluator
    (compile gate: does npm run build succeed?).
    """
    wrapped = wrap_model_for_prose_tools(model)
    by_name = {t.name: t for t in tools}
    can_deploy_verify = DEPLOY_VERIFY_TOOLS.issubset(by_name)
    require_deploy = bool(require_build_probe) and can_deploy_verify
    can_verify = VERIFY_TOOLS.issubset(by_name) and not require_deploy
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
    verify_nudges = 8 if require_deploy else (4 if require_verify else 0)
    cancelled = False
    build_probe_ok = False
    cheap_verify_done = False

    for turn in range(max(1, max_turns)):
        if should_cancel and should_cancel():
            cancelled = True
            break

        deploy_verified = (
            BUILD_PROBE in called and DEPLOY_EVAL in called and build_probe_ok
        )
        verified = (
            deploy_verified
            if require_deploy
            else (VERIFY_BROWSER in called and VERIFY_EVAL in called)
        )
        if force_tools_until_mutate and not mutated and forced_left > 0:
            if prefer_write_file and turn == 0 and "write_file" in by_name:
                choice: Optional[str] = "write_file"
            else:
                choice = "required"
            forced_left -= 1
        elif require_deploy and mutated and not deploy_verified and verify_nudges > 0:
            if BUILD_PROBE not in called or not build_probe_ok:
                choice = BUILD_PROBE if BUILD_PROBE in by_name else "required"
            elif DEPLOY_EVAL not in called and DEPLOY_EVAL in by_name:
                choice = DEPLOY_EVAL
            else:
                choice = "required"
            verify_nudges -= 1
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
            and require_deploy
            and mutated
            and not deploy_verified
            and verify_nudges >= 0
            and choice in (BUILD_PROBE, DEPLOY_EVAL, "required")
        ):
            missing = []
            if BUILD_PROBE not in called or not build_probe_ok:
                missing.append(BUILD_PROBE)
            if DEPLOY_EVAL not in called:
                missing.append(DEPLOY_EVAL)
            messages.append(ai)
            messages.append(
                HumanMessage(
                    content=(
                        "Deploy compile gate incomplete. Call these tools now "
                        f"(real tool calls, not prose): {', '.join(missing)}. "
                        "Primary test: build_probe must return ok:true / "
                        "exitCode:0, then report_deploy_to_evaluator."
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
                (require_deploy or require_verify)
                and mutated
                and not verified
                and verify_nudges > 0
            ):
                if require_deploy:
                    missing = []
                    if BUILD_PROBE not in called or not build_probe_ok:
                        missing.append(BUILD_PROBE)
                    if DEPLOY_EVAL not in called:
                        missing.append(DEPLOY_EVAL)
                else:
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
            just_mutated = False
            if tool is None:
                content = f"Error: unknown tool {name!r}"
            else:
                content = _invoke_tool(tool, args)
                if name in MUTATING_TOOLS and not content.startswith("Error:"):
                    just_mutated = not mutated
                    mutated = True
                if name in VERIFY_TOOLS and not str(content).startswith("Error:"):
                    # browser_check with skipped:true still counts as attempted.
                    called.add(name)
                if name in DEPLOY_VERIFY_TOOLS and not str(content).startswith(
                    "Error:"
                ):
                    called.add(name)
                    if name == BUILD_PROBE:
                        try:
                            parsed = __import__("json").loads(content)
                            build_probe_ok = bool(parsed.get("ok"))
                        except Exception:  # noqa: BLE001
                            build_probe_ok = '"ok": true' in content.lower()
            messages.append(
                ToolMessage(content=content, tool_call_id=call_id, name=name)
            )
            # After first successful mutate: cheap typecheck/build snip before
            # Playwright / build_probe (Aider-style lint-after-edit).
            if (
                just_mutated
                and not cheap_verify_done
                and (require_verify or require_deploy)
                and "bash" in by_name
            ):
                cheap_verify_done = True
                cheap = _invoke_tool(
                    by_name["bash"],
                    {
                        "command": CHEAP_VERIFY_CMD,
                        "description": "cheap post-mutate verify",
                    },
                )
                messages.append(
                    HumanMessage(
                        content=(
                            "Post-mutate cheap verify (auto). If there are type/build "
                            "errors, fix with edit_file (prefer surgical SEARCH/REPLACE) "
                            "before browser_check / build_probe.\n"
                            f"```\n{str(cheap)[:4000]}\n```"
                        )
                    )
                )
        if cancelled:
            break

    verified = (
        (BUILD_PROBE in called and DEPLOY_EVAL in called and build_probe_ok)
        if require_deploy
        else (VERIFY_BROWSER in called and VERIFY_EVAL in called)
    )
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
    if require_deploy and mutated and not verified and not cancelled:
        output = (
            f"{output}\n\n---\n"
            "Warning: finished without successful build_probe + "
            "report_deploy_to_evaluator. Treat compile as unverified."
        )
    elif require_verify and mutated and not verified and not cancelled:
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


# --- Intended API from the build brief (OpenAI-dict models, in-memory workspaces) ---


def recover_tool_call_from_prose(text: str) -> Optional[dict[str, Any]]:
    """First tool call recoverable from assistant prose, OpenAI-arg shape."""
    calls = extract_prose_tool_calls(text)
    if not calls:
        return None
    return {"name": calls[0]["name"], "arguments": calls[0]["args"]}


def apply_scaffold_fallback(
    *, prompt: str, workspace: dict[str, str]
) -> dict[str, str]:
    """In-memory variant of scaffold_fallback.apply_scaffold_fallback."""
    from programming_agent.scaffold_fallback import (
        build_fallback_page,
        extract_user_request,
    )

    out = dict(workspace)
    out["app/page.tsx"] = build_fallback_page(extract_user_request(prompt))
    return out


def _to_openai_message(msg: BaseMessage) -> dict[str, Any]:
    import json as _json

    if isinstance(msg, SystemMessage):
        return {"role": "system", "content": _message_content(msg)}
    if isinstance(msg, ToolMessage):
        return {
            "role": "tool",
            "content": _message_content(msg),
            "tool_call_id": msg.tool_call_id,
        }
    if isinstance(msg, AIMessage):
        calls = [
            {
                "id": _tool_id(c, i),
                "type": "function",
                "function": {
                    "name": _tool_name(c),
                    "arguments": _json.dumps(_tool_args(c)),
                },
            }
            for i, c in enumerate(getattr(msg, "tool_calls", None) or [])
        ]
        return {
            "role": "assistant",
            "content": _message_content(msg) or None,
            "tool_calls": calls or None,
        }
    return {"role": "user", "content": _message_content(msg)}


def _from_openai_message(reply: Any) -> AIMessage:
    import json as _json

    if isinstance(reply, BaseMessage):
        return reply if isinstance(reply, AIMessage) else AIMessage(content=_message_content(reply))
    if not isinstance(reply, dict):
        return AIMessage(content=str(reply or ""))
    calls = []
    for i, c in enumerate(reply.get("tool_calls") or []):
        fn = c.get("function") or {}
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = _json.loads(args)
            except _json.JSONDecodeError:
                args = {}
        calls.append(
            {
                "name": str(fn.get("name") or c.get("name") or ""),
                "args": args if isinstance(args, dict) else {},
                "id": str(c.get("id") or f"call_{i}"),
                "type": "tool_call",
            }
        )
    return AIMessage(content=reply.get("content") or "", tool_calls=calls)


class _DictModelAdapter:
    """Bridge an OpenAI-dict-style model (`.chat(messages, tools, tool_choice)`)
    into the bind_tools/invoke interface run_tool_loop expects."""

    def __init__(
        self,
        model: Any,
        tools: Optional[Sequence[BaseTool]] = None,
        tool_choice: Optional[str] = None,
    ) -> None:
        self.model = model
        self._tools = list(tools or [])
        self._choice = tool_choice

    def bind_tools(
        self, tools: Sequence[BaseTool], tool_choice: Optional[str] = None, **kw: Any
    ) -> "_DictModelAdapter":
        return _DictModelAdapter(self.model, tools, tool_choice)

    def invoke(self, messages: Sequence[BaseMessage], config: Any = None, **kw: Any) -> AIMessage:
        from langchain_core.utils.function_calling import convert_to_openai_tool

        oai_tools = [convert_to_openai_tool(t) for t in self._tools]
        try:
            reply = self.model.chat(
                [_to_openai_message(m) for m in messages],
                tools=oai_tools or None,
                tool_choice=self._choice,
            )
        except (IndexError, StopIteration):
            # Scripted/test models with no replies left: treat as final answer.
            return AIMessage(content="")
        return _from_openai_message(reply)


def run(
    *,
    model: Any,
    prompt: str,
    workspace: dict[str, str],
    max_turns: int = 8,
) -> dict[str, Any]:
    """Run the forced tool loop over an in-memory workspace dict."""
    from langchain_core.tools import StructuredTool

    written: list[str] = []

    def write_file(path: str, content: str) -> str:
        workspace[path] = content
        written.append(path)
        return f"Wrote {path}"

    def edit_file(path: str, old_string: str, new_string: str) -> str:
        src = workspace.get(path)
        if src is None or old_string not in src:
            return f"Error: old_string not found in {path}"
        workspace[path] = src.replace(old_string, new_string, 1)
        written.append(path)
        return f"Edited {path}"

    tools = [
        StructuredTool.from_function(func=write_file, name="write_file",
                                     description="Write full file contents."),
        StructuredTool.from_function(func=edit_file, name="edit_file",
                                     description="Replace old_string with new_string."),
    ]
    result = run_tool_loop(
        model=_DictModelAdapter(model),  # type: ignore[arg-type]
        tools=tools,
        system="You are a coding agent. Use write_file / edit_file to mutate the workspace.",
        user_message=prompt,
        max_turns=max_turns,
        force_tools_until_mutate=True,
        prefer_write_file=True,
    )
    return {
        "output": result.output,
        "mutated": result.mutated,
        "files_written": sorted(set(written)),
        "cancelled": result.cancelled,
    }
