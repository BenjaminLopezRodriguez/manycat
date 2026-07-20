"""Deploy-debug tools: build_probe, query_code_graph, report_deploy_to_evaluator."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from programming_agent.tools.code_graph import graph_from_workspace
from programming_agent.tools.filesystem import ToolContext


class BuildProbeInput(BaseModel):
    reason: str = Field(
        default="verify production build",
        description="Why you are probing the build (short).",
    )


class QueryCodeGraphInput(BaseModel):
    seeds: list[str] = Field(
        default_factory=list,
        description="File paths or node ids to expand from.",
    )
    hops: int = Field(default=2, description="Graph hops (1-2).")
    budget_chars: int = Field(
        default=10_000,
        description="Max serialized chars for the returned slice.",
    )


class ReportDeployToEvaluatorInput(BaseModel):
    goal: str = Field(description="Deploy/compile goal.")
    evidence: str = Field(
        description="Must include build_probe JSON (ok/exitCode) and log excerpts."
    )
    claim: str = Field(description="What you claim about the build/deploy now.")


def _http_json(
    url: str,
    *,
    method: str = "GET",
    body: Optional[dict[str, Any]] = None,
    timeout: float = 480.0,
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


def make_deploy_debug_tools(ctx: ToolContext) -> list[StructuredTool]:
    def _local_build_probe(reason: str) -> str:
        import subprocess
        import time

        root = ctx.workspace_root
        started = time.time()
        has_lock = (root / "package-lock.json").is_file()
        install = "npm ci" if has_lock else "npm install"
        env = {
            **os.environ,
            "CI": "true",
            "NODE_ENV": "production",
            "DATABASE_URL": "postgresql://user:pass@127.0.0.1:5432/build",
        }
        try:
            proc = subprocess.run(
                ["sh", "-lc", f"{install} && npm run build"],
                cwd=str(root),
                env=env,
                capture_output=True,
                text=True,
                timeout=480,
            )
            output = (proc.stdout or "") + (proc.stderr or "")
            return json.dumps(
                {
                    "ok": proc.returncode == 0,
                    "exitCode": proc.returncode,
                    "durationMs": int((time.time() - started) * 1000),
                    "mode": "harness-local",
                    "outputTail": output[-16_000:],
                    "reason": reason,
                },
                indent=2,
            )
        except Exception as exc:  # noqa: BLE001
            return json.dumps(
                {
                    "ok": False,
                    "exitCode": 1,
                    "error": str(exc)[:2000],
                    "mode": "harness-local",
                    "reason": reason,
                }
            )

    def build_probe(reason: str = "verify production build") -> str:
        orch = ctx.orchestrator_url
        wf = ctx.workflow_id
        if orch and wf:
            try:
                data = _http_json(
                    f"{orch.rstrip('/')}/sandboxes/{wf}/build-probe",
                    method="POST",
                    body={},
                    timeout=500.0,
                )
                exit_code = data.get("exitCode")
                if not isinstance(exit_code, int):
                    exit_code = 0 if data.get("ok") else 1
                return json.dumps(
                    {
                        "ok": bool(data.get("ok")),
                        "exitCode": exit_code,
                        "durationMs": data.get("durationMs"),
                        "mode": data.get("mode"),
                        "outputTail": str(
                            data.get("output") or data.get("error") or ""
                        )[-16_000:],
                        "reason": reason,
                    },
                    indent=2,
                )
            except Exception:  # noqa: BLE001
                pass
        return _local_build_probe(reason)

    def query_code_graph(
        seeds: Optional[list[str]] = None,
        hops: int = 2,
        budget_chars: int = 10_000,
    ) -> str:
        seed_list = list(seeds or [])
        if not seed_list:
            seed_list = ["app/page.tsx", "package.json", "railway.toml"]
        slice_ = graph_from_workspace(
            ctx.workspace_root,
            seeds=seed_list,
            hops=max(1, min(int(hops), 3)),
            budget_chars=max(1000, min(int(budget_chars), 20_000)),
        )
        return json.dumps(slice_, indent=2)

    def report_deploy_to_evaluator(goal: str, evidence: str, claim: str) -> str:
        base = ctx.eval_url
        if not base:
            return (
                "Error: MODAL_EVAL_URL is not configured on the agent harness. "
                "Deploy infra/modal/serve_eval.py and set MODAL_EVAL_URL."
            )
        system = (
            "You are a strict deploy/compile gate evaluator. "
            "Primary test: does production `npm run build` succeed?\n"
            "Pass ONLY if evidence includes build_probe with ok:true / exitCode:0. "
            "Ignore UI polish. Fail if the agent claims success without a successful "
            "build_probe.\n"
            "Reply with ONLY compact JSON:\n"
            '{"verdict":"pass"|"fail","confidence":0-1,"issues":["..."],'
            '"required_fixes":["..."],"summary":"one sentence"}'
        )
        user = (
            f"GOAL:\n{goal}\n\nCLAIM:\n{claim}\n\nEVIDENCE:\n{evidence[:14_000]}"
        )
        api_key = os.getenv("OPENAI_API_KEY") or "local-dev-key"
        endpoint = base.rstrip("/")
        chat_url = (
            f"{endpoint}/chat/completions"
            if endpoint.endswith("/v1")
            else f"{endpoint}/v1/chat/completions"
        )
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
            return f"report_deploy_to_evaluator failed: {exc}"
        content = (
            body.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return content or json.dumps(body)[:4000]

    return [
        StructuredTool.from_function(
            func=build_probe,
            name="build_probe",
            description=(
                "REQUIRED for deploy_debug compile loop. Run npm install + "
                "npm run build in the sandbox/VM. Pass only when exitCode is 0. "
                "This is the primary 'does the page build' test — cheaper than "
                "Railway redeploy."
            ),
            args_schema=BuildProbeInput,
            handle_tool_error=True,
        ),
        StructuredTool.from_function(
            func=query_code_graph,
            name="query_code_graph",
            description=(
                "Return a budgeted code-graph slice (imports/routes/deps) for "
                "seeds. Never dumps the whole repo. Use when fileHints are thin."
            ),
            args_schema=QueryCodeGraphInput,
            handle_tool_error=True,
        ),
        StructuredTool.from_function(
            func=report_deploy_to_evaluator,
            name="report_deploy_to_evaluator",
            description=(
                "Deploy/compile evaluator. Pass only with build_probe ok:true "
                "in evidence. Call after a successful build_probe."
            ),
            args_schema=ReportDeployToEvaluatorInput,
            handle_tool_error=True,
        ),
    ]
