"""Playwright browser check + sandbox log fetch + Modal evaluator report."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from programming_agent.tools.filesystem import ToolContext


class BrowserCheckInput(BaseModel):
    url: Optional[str] = Field(
        default=None,
        description="Page URL to open. Defaults to the sandbox preview URL for this workflow.",
    )
    wait_ms: int = Field(
        default=1500,
        description="Extra wait after load for client JS (ms).",
    )
    action: str = Field(
        default="inspect",
        description="inspect | click | fill — inspect is default health check.",
    )
    selector: Optional[str] = Field(
        default=None,
        description="CSS selector for click/fill actions.",
    )
    value: Optional[str] = Field(
        default=None,
        description="Value for fill action.",
    )


class ReadAppLogsInput(BaseModel):
    lines: int = Field(default=80, description="Tail of sandbox container logs.")
    command: Optional[str] = Field(
        default=None,
        description="Optional override: shell command inside sandbox (string).",
    )


class ReportToEvaluatorInput(BaseModel):
    goal: str = Field(description="What the UI was supposed to do / user request.")
    evidence: str = Field(
        description=(
            "Evidence from browser_check / read_app_logs / file edits. "
            "Include console errors, visible text, HTTP status, log excerpts."
        )
    )
    claim: str = Field(
        description="What you claim is true about the app right now.",
    )


def _http_json(
    url: str,
    *,
    method: str = "GET",
    body: Optional[dict[str, Any]] = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    data = None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail[:2000]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc.reason}") from exc


def _agent_reachable_url(url: str) -> str:
    """Rewrite host-facing preview URLs so Playwright inside Docker can reach them."""
    rewrite = (os.getenv("PREVIEW_URL_HOST_REWRITE") or "").strip()
    if not rewrite:
        return url
    out = url
    for host in ("localhost", "127.0.0.1", "0.0.0.0"):
        out = out.replace(f"://{host}:", f"://{rewrite}:")
        out = out.replace(f"://{host}/", f"://{rewrite}/")
    return out


_SKIPPED_RESULT = {
    "status": "skipped",
    "skipped": True,
    "reason": "no_preview_url",
    "message": (
        "Sandbox has no live preview URL (workspace-only / Docker "
        "unavailable). Skip asking the user. Read app/page.tsx, "
        "call read_app_logs if useful, then report_to_evaluator with "
        "file evidence and note preview was unavailable."
    ),
}


def browser_check(preview_url: Optional[str] = None, **kwargs: Any) -> dict[str, Any]:
    """Context-free check: skipped dict when no URL, else a Playwright report."""
    from pathlib import Path

    if not (preview_url or "").strip():
        return dict(_SKIPPED_RESULT)
    ctx = ToolContext(Path.cwd(), preview_url=preview_url)
    tool = make_browser_tools(ctx)[0]
    raw = tool.func(url=preview_url, **kwargs)  # type: ignore[misc]
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {"status": "error", "message": str(raw)}


def make_browser_tools(ctx: ToolContext) -> list[StructuredTool]:
    def browser_check(
        url: Optional[str] = None,
        wait_ms: int = 1500,
        action: str = "inspect",
        selector: Optional[str] = None,
        value: Optional[str] = None,
    ) -> str:
        target = _agent_reachable_url((url or ctx.preview_url or "").strip())
        if not target:
            # Workspace-only sandboxes (no Docker) have no live preview.
            # Do not ask the user for a URL — report skipped and continue via files/logs.
            return json.dumps(_SKIPPED_RESULT, indent=2)

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return (
                "Error: playwright is not installed in the agent image. "
                "Redeploy agent-harness with playwright browsers."
            )

        console: list[str] = []
        page_errors: list[str] = []
        failed_requests: list[str] = []

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.on(
                    "console",
                    lambda msg: console.append(f"[{msg.type}] {msg.text}"),
                )
                page.on(
                    "pageerror",
                    lambda err: page_errors.append(str(err)),
                )
                page.on(
                    "requestfailed",
                    lambda req: failed_requests.append(
                        f"{req.method} {req.url} — {req.failure}"
                    ),
                )
                response = page.goto(target, wait_until="domcontentloaded", timeout=30_000)
                status = response.status if response else None
                if wait_ms > 0:
                    page.wait_for_timeout(min(wait_ms, 10_000))

                if action == "click" and selector:
                    page.click(selector, timeout=10_000)
                    page.wait_for_timeout(500)
                elif action == "fill" and selector and value is not None:
                    page.fill(selector, value, timeout=10_000)

                title = page.title()
                body_text = page.inner_text("body")[:4000]
                html_len = len(page.content())
                browser.close()
        except Exception as exc:  # noqa: BLE001
            return f"browser_check failed for {target}: {exc}"

        report = {
            "url": target,
            "http_status": status,
            "title": title,
            "html_bytes": html_len,
            "visible_text_excerpt": body_text,
            "console": console[-40:],
            "page_errors": page_errors[-20:],
            "failed_requests": failed_requests[-20:],
        }
        return json.dumps(report, indent=2)

    def read_app_logs(lines: int = 80, command: Optional[str] = None) -> str:
        orch = ctx.orchestrator_url
        wf = ctx.workflow_id
        if not orch or not wf:
            # Fallback: local next log files if present
            candidates = [
                ctx.workspace_root / ".next" / "trace",
                ctx.workspace_root / "npm-debug.log",
            ]
            for path in candidates:
                if path.is_file():
                    text = path.read_text(encoding="utf-8", errors="replace")
                    return text[-8000:]
            return (
                "Error: SANDBOX_ORCHESTRATOR_URL / workflow_id not set; "
                "cannot fetch container logs."
            )

        lines = max(10, min(int(lines), 400))
        if command:
            cmd = ["sh", "-lc", command]
        else:
            # Prefer next/npm stdout via docker logs endpoint if present.
            cmd = [
                "sh",
                "-lc",
                f"tail -n {lines} /tmp/next-dev.log 2>/dev/null "
                f"|| tail -n {lines} /var/log/app.log 2>/dev/null "
                f"|| (ps aux | head -20; echo '---'; ls -la /app 2>/dev/null | head -30)",
            ]

        try:
            # Prefer dedicated logs route when available.
            logs_url = f"{orch.rstrip('/')}/sandboxes/{wf}/logs?lines={lines}"
            try:
                data = _http_json(logs_url, timeout=20.0)
                out = data.get("output") or data.get("logs") or ""
                if out:
                    return str(out)[-12_000:]
            except Exception:  # noqa: BLE001
                pass

            data = _http_json(
                f"{orch.rstrip('/')}/sandboxes/{wf}/exec",
                method="POST",
                body={"command": cmd, "timeoutMs": 20_000},
                timeout=30.0,
            )
            output = data.get("output") or ""
            code = data.get("exitCode")
            return f"exit={code}\n{str(output)[-12_000:]}"
        except Exception as exc:  # noqa: BLE001
            return f"read_app_logs failed: {exc}"

    def report_to_evaluator(goal: str, evidence: str, claim: str) -> str:
        base = ctx.eval_url
        if not base:
            return (
                "Error: MODAL_EVAL_URL is not configured on the agent harness. "
                "Deploy infra/modal/serve_eval.py and set MODAL_EVAL_URL."
            )

        system = (
            "You are a strict QA evaluator for web apps built by an agent. "
            "Given a goal, the agent's claim, and evidence (browser_check JSON, "
            "logs, console errors), decide if the claim is supported.\n"
            "Reply with ONLY compact JSON:\n"
            '{"verdict":"pass"|"fail","confidence":0-1,"issues":["..."],'
            '"required_fixes":["..."],"summary":"one sentence"}'
        )
        user = (
            f"GOAL:\n{goal}\n\nCLAIM:\n{claim}\n\nEVIDENCE:\n{evidence[:14_000]}"
        )
        api_key = os.getenv("OPENAI_API_KEY") or "local-dev-key"
        endpoint = base.rstrip("/")
        if not endpoint.endswith("/v1"):
            # Allow either .../v1 or bare modal URL
            chat_url = f"{endpoint}/v1/chat/completions"
        else:
            chat_url = f"{endpoint}/chat/completions"

        payload = {
            "model": os.getenv("EVAL_MODEL_NAME", "eval"),
            "temperature": 0.1,
            "max_tokens": 800,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        req = urllib.request.Request(
            chat_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120.0) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            return f"report_to_evaluator failed: {exc}"

        content = (
            body.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return content or json.dumps(body)[:4000]

    return [
        StructuredTool.from_function(
            func=browser_check,
            name="browser_check",
            description=(
                "REQUIRED for website/UI tasks. Open the preview (or url) with "
                "Playwright, capture HTTP status, visible text, console errors, "
                "and failed requests. Use after building UI and before claiming done."
            ),
            args_schema=BrowserCheckInput,
            handle_tool_error=True,
        ),
        StructuredTool.from_function(
            func=read_app_logs,
            name="read_app_logs",
            description=(
                "Read sandbox / Next.js process logs to debug runtime errors. "
                "Use with browser_check when the page is blank or console shows errors."
            ),
            args_schema=ReadAppLogsInput,
            handle_tool_error=True,
        ),
        StructuredTool.from_function(
            func=report_to_evaluator,
            name="report_to_evaluator",
            description=(
                "REQUIRED before finishing website work. Send goal + browser/log "
                "evidence + your claim to the Modal evaluator model. If verdict is "
                "fail, fix issues and re-check until pass (or explain blockers)."
            ),
            args_schema=ReportToEvaluatorInput,
            handle_tool_error=True,
        ),
    ]
