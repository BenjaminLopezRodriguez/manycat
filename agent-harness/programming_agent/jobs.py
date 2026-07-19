"""In-memory async agent jobs (single Railway replica)."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Optional

JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]


@dataclass
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def add(self, prompt: int, completion: int) -> None:
        self.prompt_tokens += max(0, prompt)
        self.completion_tokens += max(0, completion)

    def as_dict(self) -> dict[str, int]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
        }


@dataclass
class AgentJob:
    id: str
    workflow_id: str
    status: JobStatus = "queued"
    output: str = ""
    error: Optional[str] = None
    usage: TokenUsage = field(default_factory=TokenUsage)
    cancel_requested: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def request_cancel(self) -> None:
        with self._lock:
            self.cancel_requested = True

    def is_cancelled(self) -> bool:
        with self._lock:
            return self.cancel_requested


_JOBS: dict[str, AgentJob] = {}
_JOBS_LOCK = threading.Lock()


def create_job(workflow_id: str) -> AgentJob:
    job = AgentJob(id=uuid.uuid4().hex, workflow_id=workflow_id)
    with _JOBS_LOCK:
        _JOBS[job.id] = job
    return job


def get_job(job_id: str) -> Optional[AgentJob]:
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def start_background(fn: Callable[[], None]) -> None:
    thread = threading.Thread(target=fn, daemon=True)
    thread.start()
