from __future__ import annotations

from typing import Optional

from programming_agent.tools.browser import make_browser_tools
from programming_agent.tools.deploy_debug import make_deploy_debug_tools
from programming_agent.tools.filesystem import (
    ToolContext,
    make_bash_tool,
    make_filesystem_tools,
    make_task_tool,
    make_todo_tool,
)
from programming_agent.tools.research import ResearchBriefStore, make_research_tools


def build_tools(
    ctx: ToolContext,
    explore_runner,
    *,
    deploy_debug: bool = False,
    research_store: Optional[ResearchBriefStore] = None,
):
    tools = [
        *make_filesystem_tools(ctx),
        make_bash_tool(ctx),
        *make_browser_tools(ctx),
        make_todo_tool(),
        make_task_tool(explore_runner),
        *make_deploy_debug_tools(ctx),
    ]
    if research_store is not None and research_store.chunks():
        tools.extend(make_research_tools(research_store))
    return tools
