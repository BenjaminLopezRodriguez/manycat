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


class RunRequest(BaseModel):
    prompt: str
    workflow_id: str = Field(description="Workflow / sandbox identifier")
    mode: Literal["default", "plan", "explore"] = "default"
    model: Optional[str] = Field(
        default=None,
        description="UI model id or LangChain id (auto, qwen-coder, gpt-4o, …)",
    )
    effort: Optional[Literal["low", "medium", "high", "max"]] = "high"


class RunResponse(BaseModel):
    workflow_id: str
    output: str
    workspace_path: str
    model: str
    effort: str


def workspace_for(workflow_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in workflow_id)
    path = (WORKSPACE_ROOT / safe).resolve()
    if not str(path).startswith(str(WORKSPACE_ROOT)):
        raise HTTPException(status_code=400, detail="Invalid workflow_id")
    path.mkdir(parents=True, exist_ok=True)
    return path


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
    effort = body.effort or "high"
    config = AgentConfig.from_request(
        model=body.model,
        effort=effort,
        workspace_root=workspace,
    )
    harness = ProgrammingAgentHarness(config)
    mode = AgentMode(body.mode)

    try:
        output = harness.run(body.prompt, mode=mode)
    except Exception as exc:  # noqa: BLE001 — HTTP boundary
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return RunResponse(
        workflow_id=body.workflow_id,
        output=output,
        workspace_path=str(workspace),
        model=config.model,
        effort=effort,
    )
