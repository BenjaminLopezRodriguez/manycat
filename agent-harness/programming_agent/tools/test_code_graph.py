"""Unit tests for render_repo_map (stdlib unittest — no pytest required)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from programming_agent.tools.code_graph import render_repo_map


def _write_ws(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


# lib/util.ts imported by a/b/c → highest in-degree; importers each out-degree 1.
FILES = {
    "lib/util.ts": "export function shared() { return 1 }\n"
    "export const VERSION = '1'\n",
    "a.ts": 'import { shared } from "./lib/util"\nexport const A = shared()\n',
    "b.ts": 'import { shared } from "./lib/util"\nexport const B = shared()\n',
    "c.ts": 'import { shared } from "./lib/util"\nexport const C = shared()\n',
}


class TestRenderRepoMap(unittest.TestCase):
    def test_empty_workspace_returns_blank(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(render_repo_map(Path(d)), "")

    def test_degree_ranking_picks_most_imported_first(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _write_ws(root, FILES)
            out = render_repo_map(root, seeds=None, budget_chars=6000)
            lines = out.splitlines()
            self.assertTrue(lines[0].startswith("REPO MAP"))
            # First data line = the most-imported file (deg 3).
            self.assertTrue(
                lines[1].startswith("lib/util.ts"),
                f"expected lib/util.ts first, got: {lines[1]}",
            )
            self.assertIn("(deg 3)", lines[1])
            self.assertIn("def: shared", lines[1])

    def test_respects_budget_chars(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _write_ws(root, FILES)
            full = render_repo_map(root, budget_chars=6000)
            small = render_repo_map(root, budget_chars=120)
            self.assertLessEqual(len(small), 120)
            # Truncation actually happened.
            self.assertLess(len(small), len(full))
            # Highest-degree line survives truncation.
            self.assertTrue(small.splitlines()[1].startswith("lib/util.ts"))


if __name__ == "__main__":
    unittest.main()
