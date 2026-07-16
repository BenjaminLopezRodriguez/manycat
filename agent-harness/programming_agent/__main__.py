from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from programming_agent.config import AgentConfig
from programming_agent.harness import ProgrammingAgentHarness
from programming_agent.prompts.sections import AgentMode


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Run the programming agent harness (Claude Code-style LangChain agent)",
    )
    parser.add_argument("prompt", nargs="?", help="Task for the agent")
    parser.add_argument(
        "--mode",
        choices=[m.value for m in AgentMode],
        default=AgentMode.DEFAULT.value,
    )
    parser.add_argument(
        "--workspace",
        type=str,
        default=None,
        help="Workspace root (default: cwd or WORKSPACE_ROOT)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="LangChain model id, e.g. gpt-4o or anthropic:claude-sonnet-4-20250514",
    )
    parser.add_argument(
        "--print-prompt",
        action="store_true",
        help="Print assembled system prompt and exit",
    )
    args = parser.parse_args(argv)

    config = AgentConfig()
    if args.workspace:
        from pathlib import Path

        config.workspace_root = Path(args.workspace).resolve()
    if args.model:
        config.model = args.model

    harness = ProgrammingAgentHarness(config)

    if args.print_prompt:
        from programming_agent.prompts.assembler import SessionContext, assemble_system_prompt, load_project_rules

        rules = load_project_rules(config.project_rules_path)
        print(
            assemble_system_prompt(
                SessionContext(
                    workspace_root=config.workspace_root,
                    mode=AgentMode(args.mode),
                    project_rules=rules,
                )
            )
        )
        return

    if not args.prompt:
        parser.error("prompt is required unless --print-prompt is set")

    try:
        output = harness.run(args.prompt, mode=AgentMode(args.mode))
    except Exception as exc:  # noqa: BLE001 — CLI boundary
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    print(output)


if __name__ == "__main__":
    main()
