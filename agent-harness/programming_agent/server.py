from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from programming_agent.config import AgentConfig
from programming_agent.harness import ProgrammingAgentHarness
from programming_agent.jobs import AgentJob, create_job, get_job, start_background
from programming_agent.prompts.assembler import SessionContext, assemble_system_prompt, load_project_rules
from programming_agent.prompts.sections import (
    AgentMode,
    RUN_KIND_MODIFY,
    RUN_KIND_ONESHOT,
    RUN_KIND_UNDERSTAND,
)
from programming_agent.scaffold_fallback import apply_scaffold_fallback
from programming_agent.tool_loop import run_tool_loop
from programming_agent.tools import ToolContext, build_tools
from programming_agent.tools.code_graph import render_repo_map
from programming_agent.tools.compose import build_compose_env_prompt
from programming_agent.tools.filesystem import make_filesystem_tools
from programming_agent.tools.research import ResearchBriefStore

app = FastAPI(title="Programming Agent Harness", version="0.1.0")

WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/workspace")).resolve()

SKIP_DIR_NAMES = {".git", "node_modules", ".next", "__pycache__", ".venv", "dist", "build"}
MAX_FILE_BYTES = 512_000
MAX_FILES = 400


class WorkspaceFile(BaseModel):
    path: str
    contents: str


class RunRequest(BaseModel):
    prompt: str
    workflow_id: str = Field(description="Workflow / sandbox identifier")
    mode: Literal["default", "plan", "explore"] = "default"
    job_mode: Optional[Literal["deploy_debug", "compose_env"]] = Field(
        default=None,
        description="deploy_debug = compile-fix loop with build_probe gate; "
        "compose_env = synthesize Dockerfile deploy env",
    )
    run_kind: Optional[Literal["oneshot", "understand", "modify"]] = Field(
        default=None,
        description="oneshot=greenfield scaffold replace; modify=minimal diff; "
        "understand=no mutate",
    )
    deploy_bundle: Optional[dict] = Field(
        default=None,
        description="DeployDebugBundle JSON from Manycat (logs, CoT, graphSlice)",
    )
    model: Optional[str] = Field(
        default=None,
        description="UI model id or LangChain id (auto, qwen-coder, gpt-4o, …)",
    )
    effort: Optional[Literal["low", "medium", "high", "max"]] = "high"
    files: Optional[list[WorkspaceFile]] = Field(
        default=None,
        description="Seed workspace from orchestrator / Manycat before running",
    )
    preview_url: Optional[str] = Field(
        default=None,
        description="Sandbox preview URL for browser_check (Playwright)",
    )
    research_brief: Optional[dict] = Field(
        default=None,
        description="Chunked websearch brief from Manycat research harness",
    )
    context_pack: Optional[dict] = Field(
        default=None,
        description="Trimmed ContextPack (origin, plan, codebase, research)",
    )


class RunResponse(BaseModel):
    workflow_id: str
    output: str
    workspace_path: str
    model: str
    effort: str
    files: list[WorkspaceFile] = Field(default_factory=list)


class JobCreateResponse(BaseModel):
    job_id: str
    workflow_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    workflow_id: str
    status: str
    output: str = ""
    error: Optional[str] = None
    usage: dict[str, int] = Field(default_factory=dict)
    files: list[WorkspaceFile] = Field(default_factory=list)
    model: Optional[str] = None
    effort: Optional[str] = None


def workspace_for(workflow_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in workflow_id)
    path = (WORKSPACE_ROOT / safe).resolve()
    if not str(path).startswith(str(WORKSPACE_ROOT)):
        raise HTTPException(status_code=400, detail="Invalid workflow_id")
    path.mkdir(parents=True, exist_ok=True)
    return path


def seed_workspace(root: Path, files: list[WorkspaceFile]) -> None:
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail="too many files")
    for file in files:
        rel = file.path.replace("\\", "/").lstrip("/")
        if not rel or ".." in rel.split("/"):
            raise HTTPException(status_code=400, detail=f"invalid path: {file.path}")
        full = (root / rel).resolve()
        if not str(full).startswith(str(root)):
            raise HTTPException(status_code=400, detail=f"path escape: {file.path}")
        if len(file.contents.encode("utf-8")) > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail=f"file too large: {file.path}")
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(file.contents, encoding="utf-8")


def walk_workspace(root: Path) -> list[WorkspaceFile]:
    out: list[WorkspaceFile] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
        for name in filenames:
            if len(out) >= MAX_FILES:
                return out
            full = Path(dirpath) / name
            try:
                if full.stat().st_size > MAX_FILE_BYTES:
                    continue
                text = full.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            rel = full.relative_to(root).as_posix()
            out.append(WorkspaceFile(path=rel, contents=text))
    return out


def build_deploy_debug_prompt(
    prompt: str,
    files: list[WorkspaceFile],
    deploy_bundle: Optional[dict],
) -> str:
    tree = "\n".join(f"- {f.path}" for f in files[:80])
    bundle_json = ""
    if deploy_bundle:
        try:
            import json as _json

            bundle_json = _json.dumps(deploy_bundle, indent=2)[:28_000]
        except (TypeError, ValueError):
            bundle_json = str(deploy_bundle)[:28_000]
    return (
        "DEPLOY DEBUG MODE — fix compile/deploy failures.\n"
        "Primary test: build_probe must return ok:true (npm run build exit 0).\n"
        "Use query_code_graph for budgeted context; do not ask for the full repo.\n"
        "Keep Next App Router + railway.toml using npm / next start on $PORT.\n\n"
        f"DeployDebugBundle:\n```json\n{bundle_json}\n```\n\n"
        f"Workspace file tree ({len(files)} files):\n{tree}\n\n"
        f"User / system goal:\n{prompt}"
    )


def build_user_prompt(
    prompt: str,
    files: list[WorkspaceFile],
    *,
    preview_url: Optional[str] = None,
) -> str:
    file_count = len(files)
    if file_count <= 0:
        return (
            "The workspace may be empty. If so, create the minimal files needed "
            "with write_file (do not only describe changes).\n\n"
            f"User request:\n{prompt}"
        )

    tree = "\n".join(f"- {f.path}" for f in files[:80])
    # Inline small trees so weak OpenAI-compatible backends still see the project
    # even when tool_calls parsing is flaky.
    total = sum(len(f.contents) for f in files)
    body = ""
    if total <= 40_000 and file_count <= 40:
        chunks: list[str] = []
        for f in files:
            chunks.append(f"### `{f.path}`\n```\n{f.contents}\n```")
        body = "\n\nCurrent project files:\n\n" + "\n\n".join(chunks)

    scaffold_hint = ""
    if still_has_scaffold(files):
        scaffold_hint = (
            "IMPORTANT: The homepage is still a Manycat scaffold. Your FIRST "
            "action must be a write_file tool call on app/page.tsx with a full "
            "working UI for the user request (use 'use client' if needed).\n\n"
        )

    preview_line = (
        f"Sandbox preview URL (use with browser_check): {preview_url}\n"
        if preview_url
        else ""
    )

    return (
        f"{scaffold_hint}"
        f"{preview_line}"
        "You are editing an existing project already present in the workspace. "
        "Apply the user's request by calling tools (glob/read_file/edit_file/write_file). "
        "Do not claim there is no project or no design task. "
        "Do not answer with JSON tool stubs in prose — invoke tools, then summarize. "
        "Replace scaffold placeholders (e.g. 'Scaffolded by Manycat') with a real working UI.\n"
        "For any website/UI request: after edits, call browser_check (or accept "
        "skipped if there is no preview URL — never ask the user for a URL), use "
        "read_app_logs if needed, then report_to_evaluator with file/browser "
        "evidence — do not finish without a pass verdict.\n\n"
        f"Workspace file tree ({file_count} files):\n{tree}"
        f"{body}\n\n"
        f"User request:\n{prompt}"
    )


SCAFFOLD_MARKER = "Scaffolded by Manycat"


def still_has_scaffold(files: list[WorkspaceFile]) -> bool:
    """True when homepage still looks like the Manycat placeholder."""
    for f in files:
        if f.path not in ("app/page.tsx", "app/page.jsx", "src/app/page.tsx"):
            continue
        text = f.contents
        if SCAFFOLD_MARKER in text:
            return True
        # Marker stripped but still a inert title-only stub (common Qwen miss).
        lowered = text.lower()
        interactive = any(
            token in lowered
            for token in (
                "usestate",
                "onclick",
                "<button",
                "onsubmit",
                "type=\"button\"",
                "type='button'",
            )
        )
        if len(text) < 400 and not interactive:
            return True
    return False


RETRY_PROMPT = (
    "Previous turn did not build a real UI. You MUST call write_file on "
    "`app/page.tsx` with a complete working implementation of the user request "
    "(include 'use client' if you use hooks/events). Do not use edit_file. "
    "Do not describe the code — write the full file contents with write_file. "
    "Remove any 'Scaffolded by Manycat' text. Include real interactive UI "
    "(buttons / inputs / state), not just a title."
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "workspace_root": str(WORKSPACE_ROOT)}


@app.get("/models")
def list_models() -> dict:
    """Models the harness can route to given current env."""
    has_modal = bool(os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE"))
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    models = [
        {
            "id": "auto",
            "label": "Auto",
            "available": True,
            "note": "Modal coder if OPENAI_BASE_URL set, else GPT-4o",
        },
        {
            "id": "qwen-coder",
            "label": "Qwen2.5 Coder",
            "available": has_modal,
            "note": "Modal vLLM open-weight",
        },
        {
            "id": "gpt-4o",
            "label": "GPT-4o",
            "available": has_openai,
            "note": "OpenAI",
        },
        {
            "id": "claude-sonnet",
            "label": "Claude Sonnet",
            "available": has_anthropic,
            "note": "Anthropic",
        },
    ]
    return {
        "models": models,
        "effort": ["low", "medium", "high", "max"],
        "default_model": "auto",
        "default_effort": "high",
    }


@app.post("/run", response_model=RunResponse)
def run_agent(body: RunRequest) -> RunResponse:
    workspace = workspace_for(body.workflow_id)
    if body.files:
        seed_workspace(workspace, body.files)

    seeded = walk_workspace(workspace)
    effort = body.effort or "high"
    config = AgentConfig.from_request(
        model=body.model,
        effort=effort,
        workspace_root=workspace,
    )
    harness = ProgrammingAgentHarness(config)
    mode = AgentMode(body.mode)
    prompt = build_user_prompt(
        body.prompt, seeded, preview_url=body.preview_url
    )
    had_scaffold = still_has_scaffold(seeded)
    harness.ctx = ToolContext(
        workspace,
        preview_url=body.preview_url,
        workflow_id=body.workflow_id,
    )

    try:
        output = harness.run(prompt, mode=mode)
        files_after = walk_workspace(workspace)
        # One recovery pass when Modal/Qwen talked about edits but left the template.
        if had_scaffold and still_has_scaffold(files_after) and mode == AgentMode.DEFAULT:
            retry = (
                f"{RETRY_PROMPT}\n\nOriginal user request:\n{body.prompt}"
            )
            output2 = harness.run(retry, mode=mode)
            output = f"{output}\n\n---\n(retry)\n{output2}"
            files_after = walk_workspace(workspace)
            if still_has_scaffold(files_after):
                # Small OpenAI-compatible models often narrate edits without
                # emitting parseable tool calls — write a real UI ourselves.
                note = apply_scaffold_fallback(workspace, body.prompt)
                files_after = walk_workspace(workspace)
                output = f"{output}\n\n---\n{note}"
    except Exception as exc:  # noqa: BLE001 — HTTP boundary
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return RunResponse(
        workflow_id=body.workflow_id,
        output=output,
        workspace_path=str(workspace),
        model=config.model,
        effort=effort,
        files=walk_workspace(workspace),
    )


def _execute_job(job: AgentJob, body: RunRequest) -> None:
    workspace = workspace_for(body.workflow_id)
    if body.files:
        seed_workspace(workspace, body.files)

    seeded = walk_workspace(workspace)
    effort = body.effort or "high"
    config = AgentConfig.from_request(
        model=body.model,
        effort=effort,
        workspace_root=workspace,
    )
    mode = AgentMode(body.mode)
    deploy_debug = body.job_mode == "deploy_debug"
    compose_env = body.job_mode == "compose_env"
    run_kind = body.run_kind or "oneshot"
    if body.context_pack and isinstance(body.context_pack, dict):
        origin = str(body.context_pack.get("origin") or "")
        if body.run_kind is None and origin == "github":
            run_kind = "modify"
    if deploy_debug:
        prompt = build_deploy_debug_prompt(
            body.prompt, seeded, body.deploy_bundle
        )
    elif compose_env:
        summary = f"{len(seeded)} files: " + ", ".join(
            f.path for f in seeded[:40]
        )
        prompt = build_compose_env_prompt(body.prompt, seeded_summary=summary)
    else:
        prompt = build_user_prompt(
            body.prompt, seeded, preview_url=body.preview_url
        )
        if run_kind == "modify":
            prompt = (
                "MODIFY MODE: minimal diffs only. Do not replace an imported "
                "or existing app with a Manycat scaffold.\n\n" + prompt
            )
        elif run_kind == "understand":
            prompt = (
                "UNDERSTAND MODE: read-only. Do not edit files.\n\n" + prompt
            )
    # Scaffold replace/fallback only for greenfield oneshot (not modify/import).
    allow_scaffold_fallback = (
        run_kind == "oneshot"
        and not deploy_debug
        and not compose_env
        and run_kind != "understand"
    )
    had_scaffold = (
        still_has_scaffold(seeded) and allow_scaffold_fallback
    )

    job.status = "running"
    setattr(job, "model", config.model)
    setattr(job, "effort", effort)
    setattr(job, "workspace", workspace)

    def on_usage(usage) -> None:
        job.usage.prompt_tokens = usage.prompt_tokens
        job.usage.completion_tokens = usage.completion_tokens

    try:
        ctx = ToolContext(
            workspace,
            preview_url=body.preview_url,
            workflow_id=body.workflow_id,
        )
        harness = ProgrammingAgentHarness(config)
        harness.ctx = ctx

        def explore(description: str, thoroughness: str) -> str:
            return harness._run_explore(description, thoroughness)

        rules = load_project_rules(config.project_rules_path)
        research_store = ResearchBriefStore(body.research_brief)
        extras: list[str] = []
        if run_kind == "oneshot":
            extras.append(RUN_KIND_ONESHOT)
        elif run_kind == "modify":
            extras.append(RUN_KIND_MODIFY)
        elif run_kind == "understand":
            extras.append(RUN_KIND_UNDERSTAND)
        if (
            research_store.summary()
            or research_store.chunks()
            or research_store.plan()
        ):
            plan = research_store.plan()
            goal = str(plan.get("goal") or research_store.summary())[:280]
            n_targets = len(research_store.targets())
            n_steps = len(research_store.steps())
            extras.append(
                "A web research brief + plan is attached. Follow WEB_RESEARCH "
                f"rules. Goal: {goal}. Plan has {n_steps} steps and "
                f"{n_targets} targets — use read_research_plan / "
                "read_research_target. "
                f"Summary: {research_store.summary()[:400]}"
            )
        if body.context_pack and isinstance(body.context_pack, dict):
            cb = body.context_pack.get("codebase")
            if isinstance(cb, dict) and cb.get("summary"):
                extras.append(
                    "Imported codebase brief: "
                    + str(cb.get("summary"))[:400]
                    + ". Entrypoints: "
                    + ", ".join(str(x) for x in (cb.get("entrypoints") or [])[:6])
                )
        # P1: budgeted repo-map — structural awareness before editing.
        # NEVER on greenfield oneshot (scaffold path).
        _rm_origin = ""
        _rm_seeds: list[str] | None = None
        if body.context_pack and isinstance(body.context_pack, dict):
            _rm_origin = str(body.context_pack.get("origin") or "")
            _cb = body.context_pack.get("codebase")
            if isinstance(_cb, dict):
                _seeds = [
                    *(_cb.get("entrypoints") or []),
                    *(_cb.get("hotspots") or []),
                ]
                _rm_seeds = [str(s) for s in _seeds] or None
        if run_kind in ("modify", "understand") or _rm_origin == "github":
            _repo_map = render_repo_map(
                workspace, seeds=_rm_seeds, budget_chars=6000
            )
            if _repo_map:
                extras.append(
                    "Repo map (structural context, budgeted):\n" + _repo_map
                )
        extra = "\n\n".join(extras) if extras else None
        system = assemble_system_prompt(
            SessionContext(
                workspace_root=workspace,
                mode=mode,
                project_rules=rules,
                extra_instructions=extra,
            )
        )
        tools = (
            build_tools(
                ctx,
                explore,
                deploy_debug=deploy_debug,
                research_store=research_store,
            )
            if mode == AgentMode.DEFAULT
            else make_filesystem_tools(ctx)
        )
        prefer_write = (
            mode == AgentMode.DEFAULT
            and run_kind == "oneshot"
            and ("Scaffolded by Manycat" in prompt or "write_file" in prompt)
        )
        force_mutate = mode == AgentMode.DEFAULT and run_kind != "understand"
        require_verify: Optional[bool]
        if deploy_debug:
            require_verify = False
        elif run_kind == "oneshot":
            require_verify = True if body.preview_url else None
        elif run_kind == "modify":
            require_verify = None  # auto-detect website-like asks
        else:
            require_verify = False

        result = run_tool_loop(
            model=harness._init_model(),
            tools=tools,
            system=system,
            user_message=prompt,
            max_turns=config.max_turns,
            force_tools_until_mutate=force_mutate,
            prefer_write_file=prefer_write,
            require_website_verification=require_verify,
            require_build_probe=deploy_debug,
            should_cancel=job.is_cancelled,
            on_usage=on_usage,
        )
        output = result.output
        job.usage = result.usage

        if result.cancelled or job.is_cancelled():
            job.status = "cancelled"
            job.output = output or "Run cancelled."
            return

        files_after = walk_workspace(workspace)
        if (
            had_scaffold
            and still_has_scaffold(files_after)
            and mode == AgentMode.DEFAULT
            and allow_scaffold_fallback
            and not job.is_cancelled()
        ):
            retry = f"{RETRY_PROMPT}\n\nOriginal user request:\n{body.prompt}"
            result2 = run_tool_loop(
                model=harness._init_model(),
                tools=tools,
                system=system,
                user_message=retry,
                max_turns=min(config.max_turns, 16),
                force_tools_until_mutate=True,
                prefer_write_file=True,
                should_cancel=job.is_cancelled,
                on_usage=on_usage,
            )
            job.usage.prompt_tokens = (
                result.usage.prompt_tokens + result2.usage.prompt_tokens
            )
            job.usage.completion_tokens = (
                result.usage.completion_tokens + result2.usage.completion_tokens
            )
            output = f"{output}\n\n---\n(retry)\n{result2.output}"
            if result2.cancelled or job.is_cancelled():
                job.status = "cancelled"
                job.output = output
                return
            files_after = walk_workspace(workspace)
            if still_has_scaffold(files_after):
                note = apply_scaffold_fallback(workspace, body.prompt)
                output = f"{output}\n\n---\n{note}"

        job.output = output
        job.status = "done"
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)
        job.output = job.output or str(exc)


@app.post("/jobs", response_model=JobCreateResponse)
def create_agent_job(body: RunRequest) -> JobCreateResponse:
    """Start an agent run in the background; poll GET /jobs/{id} for status."""
    # Ensure workspace id is valid before accepting the job.
    workspace_for(body.workflow_id)
    job = create_job(body.workflow_id)
    start_background(lambda: _execute_job(job, body))
    return JobCreateResponse(
        job_id=job.id,
        workflow_id=body.workflow_id,
        status=job.status,
    )


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_agent_job(job_id: str) -> JobStatusResponse:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    workspace = getattr(job, "workspace", None)
    files: list[WorkspaceFile] = []
    if workspace is not None and job.status in (
        "running",
        "done",
        "cancelled",
        "failed",
    ):
        try:
            files = walk_workspace(workspace)
        except OSError:
            files = []
    return JobStatusResponse(
        job_id=job.id,
        workflow_id=job.workflow_id,
        status=job.status,
        output=job.output,
        error=job.error,
        usage=job.usage.as_dict(),
        files=files,
        model=getattr(job, "model", None),
        effort=getattr(job, "effort", None),
    )


@app.post("/jobs/{job_id}/cancel")
def cancel_agent_job(job_id: str) -> dict[str, str]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    job.request_cancel()
    if job.status in ("queued", "running"):
        # Soft-cancel; worker flips to cancelled between turns.
        pass
    return {"job_id": job.id, "status": "cancel_requested"}
