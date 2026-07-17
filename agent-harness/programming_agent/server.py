from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from programming_agent.config import AgentConfig
from programming_agent.harness import ProgrammingAgentHarness
from programming_agent.prompts.sections import AgentMode

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
    model: Optional[str] = Field(
        default=None,
        description="UI model id or LangChain id (auto, qwen-coder, gpt-4o, …)",
    )
    effort: Optional[Literal["low", "medium", "high", "max"]] = "high"
    files: Optional[list[WorkspaceFile]] = Field(
        default=None,
        description="Seed workspace from orchestrator / Manycat before running",
    )


class RunResponse(BaseModel):
    workflow_id: str
    output: str
    workspace_path: str
    model: str
    effort: str
    files: list[WorkspaceFile] = Field(default_factory=list)


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


def build_user_prompt(prompt: str, files: list[WorkspaceFile]) -> str:
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

    return (
        "You are editing an existing project already present in the workspace. "
        "Apply the user's request by calling tools (glob/read_file/edit_file/write_file). "
        "Do not claim there is no project or no design task. "
        "Do not answer with JSON tool stubs in prose — invoke tools, then summarize.\n\n"
        f"Workspace file tree ({file_count} files):\n{tree}"
        f"{body}\n\n"
        f"User request:\n{prompt}"
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
    prompt = build_user_prompt(body.prompt, seeded)

    try:
        output = harness.run(prompt, mode=mode)
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
