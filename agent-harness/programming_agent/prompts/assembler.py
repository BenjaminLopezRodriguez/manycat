from __future__ import annotations

from typing import Optional

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from programming_agent.prompts.sections import (
    DYNAMIC_BOUNDARY,
    MODE_SECTIONS,
    STATIC_SECTIONS,
    AgentMode,
)


@dataclass
class SessionContext:
    workspace_root: Path
    mode: AgentMode = AgentMode.DEFAULT
    project_rules: Optional[str] = None
    extra_instructions: Optional[str] = None


def _join_sections(parts: list[str]) -> str:
    return "\n\n".join(p.strip() for p in parts if p.strip())


def assemble_system_prompt(ctx: SessionContext) -> str:
    """Build static + dynamic system prompt with an explicit cache boundary."""
    static_parts = [s.content for s in STATIC_SECTIONS]
    if ctx.mode in MODE_SECTIONS:
        static_parts.append(MODE_SECTIONS[ctx.mode].content)

    dynamic_parts = [
        f"# Environment\n"
        f"- Workspace root: `{ctx.workspace_root}`\n"
        f"- UTC time: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
        f"- Mode: {ctx.mode.value}",
    ]

    if ctx.project_rules:
        dynamic_parts.append(
            "# Project rules\n\n" + ctx.project_rules.strip()
        )

    if ctx.extra_instructions:
        dynamic_parts.append(
            "# Session instructions\n\n" + ctx.extra_instructions.strip()
        )

    return (
        _join_sections(static_parts)
        + f"\n\n{DYNAMIC_BOUNDARY}\n\n"
        + _join_sections(dynamic_parts)
    )


def split_at_boundary(prompt: str) -> tuple[str, str]:
    if DYNAMIC_BOUNDARY not in prompt:
        return prompt, ""
    static, dynamic = prompt.split(DYNAMIC_BOUNDARY, maxsplit=1)
    return static.strip(), dynamic.strip()


def load_project_rules(path: Optional[Path]) -> Optional[str]:
    candidates: list[Path] = []
    if path:
        candidates.append(path)
    candidates.extend(
        [
            Path("CLAUDE.md"),
            Path("AGENTS.md"),
            Path(".cursor/rules"),
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    return None
