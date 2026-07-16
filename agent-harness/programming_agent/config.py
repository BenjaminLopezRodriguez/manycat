from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


@dataclass
class AgentConfig:
    model: str = field(default_factory=lambda: os.getenv("MODEL", "gpt-4o"))
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
