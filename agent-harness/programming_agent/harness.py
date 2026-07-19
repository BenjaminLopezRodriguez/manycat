from __future__ import annotations

from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent

from programming_agent.config import AgentConfig
from programming_agent.prompts.assembler import SessionContext, assemble_system_prompt, load_project_rules
from programming_agent.prompts.sections import AgentMode
from programming_agent.tool_loop import run_tool_loop
from programming_agent.tools import ToolContext, build_tools
from programming_agent.tools.filesystem import make_filesystem_tools


class ProgrammingAgentHarness:
    """
    LangChain harness that assembles Claude Code-style instructions
    and runs a tool loop against any LangChain chat model.

    Default mode uses an explicit tool loop with forced tool_choice so
    OpenAI-compatible backends (Modal vLLM + Qwen) actually mutate files.
    Plan/explore keep LangGraph create_react_agent (read-heavy).
    """

    def __init__(self, config: Optional[AgentConfig] = None) -> None:
        self.config = config or AgentConfig()
        self.ctx = ToolContext(self.config.workspace_root)
        self._explore_agent = None

    def _init_model(self):
        from langchain.chat_models import init_chat_model

        kwargs: dict = {
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        }
        if self.config.openai_base_url:
            # OpenAI-compatible providers (Modal vLLM, local gateways).
            kwargs["base_url"] = self.config.openai_base_url
        return init_chat_model(self.config.model, **kwargs)

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

    def run(
        self,
        user_message: str,
        *,
        mode: AgentMode = AgentMode.DEFAULT,
        extra_instructions: Optional[str] = None,
    ) -> str:
        rules = load_project_rules(self.config.project_rules_path)
        system = assemble_system_prompt(
            SessionContext(
                workspace_root=self.ctx.workspace_root,
                mode=mode,
                project_rules=rules,
                extra_instructions=extra_instructions,
            )
        )
        model = self._init_model()

        if mode == AgentMode.PLAN:
            tools = make_filesystem_tools(self.ctx)
            agent = create_react_agent(
                model,
                tools,
                prompt=SystemMessage(content=system),
            )
            result = agent.invoke(
                {"messages": [HumanMessage(content=user_message)]},
                config={"recursion_limit": self.config.recursion_limit},
            )
            last = result["messages"][-1]
            return getattr(last, "content", str(last))

        if mode == AgentMode.EXPLORE:
            tools = make_filesystem_tools(self.ctx)
            return run_tool_loop(
                model=model,
                tools=tools,
                system=system,
                user_message=user_message,
                max_turns=min(self.config.max_turns, 16),
                force_tools_until_mutate=False,
                prefer_write_file=False,
            )

        tools = build_tools(self.ctx, self._run_explore)
        # Force tool calls until write/edit succeeds — critical for vLLM/Qwen.
        prefer_write = "Scaffolded by Manycat" in user_message or "write_file" in user_message
        return run_tool_loop(
            model=model,
            tools=tools,
            system=system,
            user_message=user_message,
            max_turns=self.config.max_turns,
            force_tools_until_mutate=True,
            prefer_write_file=prefer_write,
        )

    def stream(self, user_message: str):
        # Streaming still uses a one-shot run for now (compat with CLI).
        yield {"output": self.run(user_message)}
