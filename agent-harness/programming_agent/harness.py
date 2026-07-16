from __future__ import annotations

from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent

from programming_agent.config import AgentConfig
from programming_agent.prompts.assembler import SessionContext, assemble_system_prompt, load_project_rules
from programming_agent.prompts.sections import AgentMode
from programming_agent.tools import ToolContext, build_tools
from programming_agent.tools.filesystem import make_filesystem_tools


class ProgrammingAgentHarness:
    """
    LangChain + LangGraph harness that assembles Claude Code-style instructions
    and runs a ReAct tool loop against any LangChain chat model.
    """

    def __init__(self, config: Optional[AgentConfig] = None) -> None:
        self.config = config or AgentConfig()
        self.ctx = ToolContext(self.config.workspace_root)
        self._explore_agent = None
        self._main_agent = None

    def _init_model(self):
        from langchain.chat_models import init_chat_model

        return init_chat_model(self.config.model)

    def _run_explore(self, description: str, thoroughness: str) -> str:
        agent = self._get_explore_agent()
        prompt = (
            f"Thoroughness: {thoroughness}\n\n"
            f"Search request:\n{description}\n\n"
            "Return paths, symbols, and a concise summary."
        )
        result = agent.invoke({"messages": [HumanMessage(content=prompt)]})
        last = result["messages"][-1]
        return getattr(last, "content", str(last))

    def _get_explore_agent(self):
        if self._explore_agent is not None:
            return self._explore_agent

        rules = load_project_rules(self.config.project_rules_path)
        system = assemble_system_prompt(
            SessionContext(
                workspace_root=self.ctx.workspace_root,
                mode=AgentMode.EXPLORE,
                project_rules=rules,
            )
        )
        model = self._init_model()
        tools = make_filesystem_tools(self.ctx)
        self._explore_agent = create_react_agent(
            model,
            tools,
            prompt=SystemMessage(content=system),
        )
        return self._explore_agent

    def _get_main_agent(self):
        if self._main_agent is not None:
            return self._main_agent

        rules = load_project_rules(self.config.project_rules_path)
        system = assemble_system_prompt(
            SessionContext(
                workspace_root=self.ctx.workspace_root,
                mode=AgentMode.DEFAULT,
                project_rules=rules,
            )
        )
        model = self._init_model()
        tools = build_tools(self.ctx, self._run_explore)
        self._main_agent = create_react_agent(
            model,
            tools,
            prompt=SystemMessage(content=system),
        )
        return self._main_agent

    def run(
        self,
        user_message: str,
        *,
        mode: AgentMode = AgentMode.DEFAULT,
        extra_instructions: Optional[str] = None,
    ) -> str:
        if mode == AgentMode.PLAN:
            rules = load_project_rules(self.config.project_rules_path)
            system = assemble_system_prompt(
                SessionContext(
                    workspace_root=self.ctx.workspace_root,
                    mode=AgentMode.PLAN,
                    project_rules=rules,
                    extra_instructions=extra_instructions,
                )
            )
            model = self._init_model()
            # Plan mode: read-only tools only
            tools = make_filesystem_tools(self.ctx)
            agent = create_react_agent(
                model,
                tools,
                prompt=SystemMessage(content=system),
            )
        else:
            agent = self._get_main_agent()

        result = agent.invoke(
            {"messages": [HumanMessage(content=user_message)]},
            config={"recursion_limit": self.config.recursion_limit},
        )
        last = result["messages"][-1]
        return getattr(last, "content", str(last))

    def stream(self, user_message: str):
        agent = self._get_main_agent()
        for chunk in agent.stream(
            {"messages": [HumanMessage(content=user_message)]},
            config={"recursion_limit": self.config.recursion_limit},
            stream_mode="values",
        ):
            yield chunk
