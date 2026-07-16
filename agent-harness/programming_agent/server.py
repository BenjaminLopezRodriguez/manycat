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


class RunResponse(BaseModel):
    workflow_id: str
    output: str
    workspace_path: str


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


@app.post("/run", response_model=RunResponse)
def run_agent(body: RunRequest) -> RunResponse:
    workspace = workspace_for(body.workflow_id)
    config = AgentConfig(
        model=os.getenv("MODEL", "gpt-4o"),
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
    )
