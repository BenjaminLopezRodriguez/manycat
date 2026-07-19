from __future__ import annotations

from programming_agent.tools.browser import make_browser_tools
from programming_agent.tools.filesystem import (
    ToolContext,
    make_bash_tool,
    make_filesystem_tools,
    make_task_tool,
    make_todo_tool,
)


def build_tools(ctx: ToolContext, explore_runner):
    return [
        *make_filesystem_tools(ctx),
        make_bash_tool(ctx),
        *make_browser_tools(ctx),
        make_todo_tool(),
        make_task_tool(explore_runner),
    ]
