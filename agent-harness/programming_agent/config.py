from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

EFFORT_PRESETS: dict[str, dict[str, float | int]] = {
    "low": {
        "max_turns": 12,
        "recursion_limit": 24,
        "temperature": 0.5,
        # Coding edits need headroom; 1024 truncates write_file / prose tools mid-JSON.
        "max_tokens": 4096,
    },
    "medium": {
        "max_turns": 24,
        "recursion_limit": 48,
        "temperature": 0.35,
        "max_tokens": 4096,
    },
    "high": {
        "max_turns": 40,
        "recursion_limit": 80,
        "temperature": 0.2,
        "max_tokens": 4096,
    },
    "max": {
        "max_turns": 80,
        "recursion_limit": 160,
        "temperature": 0.1,
        "max_tokens": 8192,
    },
}


def resolve_model(model: Optional[str]) -> str:
    """Map UI / API model ids to LangChain init_chat_model ids."""
    raw = (model or os.getenv("MODEL", "gpt-4o")).strip()
    if raw in ("auto", ""):
        if os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE"):
            return "openai:coder"
        return "gpt-4o"
    aliases = {
        "qwen-coder": "openai:coder",
        "gpt-4o": "gpt-4o",
        "claude-sonnet": "anthropic:claude-sonnet-4-20250514",
        "openai:coder": "openai:coder",
    }
    return aliases.get(raw, raw)


@dataclass
class AgentConfig:
    model: str = field(default_factory=lambda: resolve_model(None))
    # OpenAI-compatible base URL for Modal vLLM / gateways, e.g. https://…/v1
    openai_base_url: Optional[str] = field(
        default_factory=lambda: os.getenv("OPENAI_BASE_URL")
        or os.getenv("OPENAI_API_BASE")
        or None
    )
    temperature: float = 0.2
    max_tokens: int = 4096
    workspace_root: Path = field(
        default_factory=lambda: Path(
            os.getenv("WORKSPACE_ROOT") or os.getcwd()
        ).resolve()
    )
    max_turns: int = int(os.getenv("MAX_TURNS", "40"))
    recursion_limit: int = int(os.getenv("RECURSION_LIMIT", "80"))
    project_rules_path: Optional[Path] = field(
        default_factory=lambda: (
            Path(p).resolve()
            if (p := os.getenv("PROJECT_RULES_PATH"))
            else None
        )
    )

    @classmethod
    def from_request(
        cls,
        *,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        workspace_root: Optional[Path] = None,
    ) -> "AgentConfig":
        preset = EFFORT_PRESETS.get(
            (effort or "high").lower(), EFFORT_PRESETS["high"]
        )
        return cls(
            model=resolve_model(model),
            workspace_root=workspace_root
            or Path(os.getenv("WORKSPACE_ROOT") or os.getcwd()).resolve(),
            max_turns=int(preset["max_turns"]),
            recursion_limit=int(preset["recursion_limit"]),
            temperature=float(preset["temperature"]),
            max_tokens=int(preset["max_tokens"]),
        )
