"""Runnable test for compose_env templates.

Run:
  cd agent-harness && .venv/bin/python -m unittest \
    programming_agent.tools.test_compose -v
"""

from __future__ import annotations

import unittest

from programming_agent.tools.compose import (
    build_compose_env_prompt,
    dockerignore,
    next_dockerfile,
    railway_toml_dockerfile,
)


class ComposeEnvTemplates(unittest.TestCase):
    def test_dockerfile_exposes_port_and_builds(self) -> None:
        df = next_dockerfile()
        self.assertIn("EXPOSE", df)
        self.assertIn("$PORT", df)
        self.assertIn("npm run build", df)

    def test_railway_toml_uses_dockerfile_builder(self) -> None:
        self.assertIn('builder = "DOCKERFILE"', railway_toml_dockerfile())

    def test_dockerignore_excludes_node_modules(self) -> None:
        ignore = dockerignore()
        self.assertIn("node_modules", ignore)
        self.assertIn(".next", ignore)
        self.assertIn(".git", ignore)

    def test_no_secrets_baked(self) -> None:
        blob = next_dockerfile() + railway_toml_dockerfile() + COMPOSE_PROMPT
        for secret in ("RAILWAY_API_TOKEN", "postgresql://", "postgres://"):
            self.assertNotIn(secret, blob)

    def test_prompt_includes_templates_and_goal(self) -> None:
        prompt = build_compose_env_prompt("dockerize my app", seeded_summary="3 files")
        self.assertIn('builder = "DOCKERFILE"', prompt)
        self.assertIn("dockerize my app", prompt)
        self.assertIn("3 files", prompt)


COMPOSE_PROMPT = build_compose_env_prompt("test goal")


if __name__ == "__main__":
    unittest.main()
