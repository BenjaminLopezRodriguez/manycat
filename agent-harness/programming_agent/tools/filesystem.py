from __future__ import annotations

from typing import Optional

import fnmatch
import os
import re
import subprocess
from pathlib import Path

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


class ToolContext:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()

    def resolve(self, path: str) -> Path:
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = self.workspace_root / candidate
        resolved = candidate.resolve()
        if not str(resolved).startswith(str(self.workspace_root)):
            raise ValueError(f"Path escapes workspace: {path}")
        return resolved


class ReadFileInput(BaseModel):
    path: str = Field(description="Absolute or workspace-relative file path")
    offset: int = Field(default=1, description="1-based start line")
    limit: int = Field(default=200, description="Max lines to return")


class WriteFileInput(BaseModel):
    path: str = Field(description="File path to write")
    content: str = Field(description="Full file contents")


class EditFileInput(BaseModel):
    path: str = Field(description="File path to edit")
    old_string: str = Field(description="Exact text to replace")
    new_string: str = Field(description="Replacement text")
    replace_all: bool = Field(default=False)


class GlobInput(BaseModel):
    pattern: str = Field(
        description='Glob relative to workspace, e.g. "src/**/*.tsx"'
    )


class GrepInput(BaseModel):
    pattern: str = Field(description="Regex pattern to search")
    path: str = Field(default=".", description="Directory or file to search")
    glob: Optional[str] = Field(default=None, description="Optional file glob filter")


class BashInput(BaseModel):
    command: str = Field(description="Shell command to run")
    description: str = Field(
        default="",
        description="Short human-readable description of why this runs",
    )


class TodoItem(BaseModel):
    id: str
    content: str
    status: str = Field(description="pending | in_progress | completed")


class TodoWriteInput(BaseModel):
    todos: list[TodoItem]


class TaskInput(BaseModel):
    description: str = Field(description="What the explore sub-agent should find")
    thoroughness: str = Field(
        default="medium",
        description="quick | medium | very thorough",
    )


def _format_numbered(content: str, offset: int) -> str:
    lines = content.splitlines()
    numbered = []
    for i, line in enumerate(lines, start=offset):
        numbered.append(f"{i:6}|{line}")
    return "\n".join(numbered)


def make_filesystem_tools(ctx: ToolContext) -> list[StructuredTool]:
    def read_file(path: str, offset: int = 1, limit: int = 200) -> str:
        resolved = ctx.resolve(path)
        text = resolved.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        start = max(offset - 1, 0)
        end = start + limit
        snippet = "\n".join(lines[start:end])
        return _format_numbered(snippet, offset)

    def write_file(path: str, content: str) -> str:
        resolved = ctx.resolve(path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        return f"Wrote {resolved} ({len(content)} bytes)"

    def edit_file(
        path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> str:
        resolved = ctx.resolve(path)
        text = resolved.read_text(encoding="utf-8")
        count = text.count(old_string)
        if count == 0:
            raise ValueError("old_string not found in file")
        if count > 1 and not replace_all:
            raise ValueError(
                f"old_string appears {count} times; set replace_all=true or provide more context"
            )
        updated = (
            text.replace(old_string, new_string)
            if replace_all
            else text.replace(old_string, new_string, 1)
        )
        resolved.write_text(updated, encoding="utf-8")
        return f"Edited {resolved}"

    def glob_search(pattern: str) -> str:
        matches: list[str] = []
        for root, dirs, files in os.walk(ctx.workspace_root):
            dirs[:] = [d for d in dirs if d not in {".git", "node_modules", ".next", "__pycache__"}]
            rel_root = Path(root).relative_to(ctx.workspace_root)
            for name in files:
                rel = str(rel_root / name).lstrip("./")
                if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(name, pattern):
                    matches.append(rel)
        return "\n".join(sorted(matches)[:500]) or "(no matches)"

    def grep(pattern: str, path: str = ".", glob: Optional[str] = None) -> str:
        target = ctx.resolve(path)
        regex = re.compile(pattern)
        hits: list[str] = []

        def scan_file(file_path: Path) -> None:
            if glob and not fnmatch.fnmatch(file_path.name, glob):
                return
            try:
                for i, line in enumerate(
                    file_path.read_text(encoding="utf-8", errors="replace").splitlines(),
                    start=1,
                ):
                    if regex.search(line):
                        rel = file_path.relative_to(ctx.workspace_root)
                        hits.append(f"{rel}:{i}:{line[:200]}")
            except (OSError, UnicodeError):
                return

        if target.is_file():
            scan_file(target)
        else:
            for root, dirs, files in os.walk(target):
                dirs[:] = [d for d in dirs if d not in {".git", "node_modules", ".next"}]
                for name in files:
                    scan_file(Path(root) / name)

        return "\n".join(hits[:200]) or "(no matches)"

    return [
        StructuredTool.from_function(
            func=read_file,
            name="read_file",
            description="Read a file with 1-based line numbers. Prefer over shell cat.",
            args_schema=ReadFileInput,
        ),
        StructuredTool.from_function(
            func=write_file,
            name="write_file",
            description="Write full contents to a file. Creates parent dirs.",
            args_schema=WriteFileInput,
        ),
        StructuredTool.from_function(
            func=edit_file,
            name="edit_file",
            description="Replace exact text in a file. Provide unique old_string context.",
            args_schema=EditFileInput,
        ),
        StructuredTool.from_function(
            func=glob_search,
            name="glob",
            description="Find files by glob pattern under the workspace.",
            args_schema=GlobInput,
        ),
        StructuredTool.from_function(
            func=grep,
            name="grep",
            description="Search file contents with regex. Prefer over shell grep.",
            args_schema=GrepInput,
        ),
    ]


def make_bash_tool(ctx: ToolContext) -> StructuredTool:
    BLOCKED = re.compile(
        r"(^|\s)(rm\s+-rf\s+/|mkfs|dd\s+if=|>\s*/dev/|curl.*\|\s*sh)",
        re.IGNORECASE,
    )

    def bash(command: str, description: str = "") -> str:
        if BLOCKED.search(command):
            raise ValueError("Command blocked by safety policy")
        proc = subprocess.run(
            command,
            shell=True,
            cwd=ctx.workspace_root,
            capture_output=True,
            text=True,
            timeout=120,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        out = out.strip() or "(no output)"
        if len(out) > 20_000:
            out = out[:20_000] + "\n…(truncated)"
        return f"exit={proc.returncode}\n{out}"

    return StructuredTool.from_function(
        func=bash,
        name="bash",
        description=(
            "Run a shell command in the workspace. Use for git, tests, builds. "
            "Prefer dedicated tools for file read/write/search."
        ),
        args_schema=BashInput,
    )


_todo_state: list[dict[str, str]] = []


def make_todo_tool() -> StructuredTool:
    def todo_write(todos: list[TodoItem]) -> str:
        global _todo_state
        _todo_state = [t.model_dump() for t in todos]
        lines = [f"- [{t['status']}] {t['id']}: {t['content']}" for t in _todo_state]
        return "Todos updated:\n" + "\n".join(lines)

    return StructuredTool.from_function(
        func=todo_write,
        name="todo_write",
        description="Track multi-step tasks. Only one item should be in_progress.",
        args_schema=TodoWriteInput,
    )


def make_task_tool(explore_runner) -> StructuredTool:
    def task(description: str, thoroughness: str = "medium") -> str:
        return explore_runner(description, thoroughness)

    return StructuredTool.from_function(
        func=task,
        name="task",
        description=(
            "Delegate read-only codebase exploration to an Explore sub-agent. "
            "Use for broad searches; implement changes yourself."
        ),
        args_schema=TaskInput,
    )
