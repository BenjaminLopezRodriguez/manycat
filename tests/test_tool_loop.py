"""Unit tests for agent-harness tool loop guarantees (checklist A, B, F).

Run from the repo root so `agent-harness/programming_agent` is importable:
    PYTHONPATH=agent-harness pytest tests/test_tool_loop.py -v

These test the *contract* Grok's implementation claimed:
1. tool_loop forces write_file until a mutation happens (no prose-only "done").
2. Hermes prose-recovery: JSON-looking prose gets converted to a real tool call.
3. Scaffold fallback applies if the template survives the loop.
4. browser_check returns {"status": "skipped"} when no preview URL — never a
   message asking the human for a URL.
5. Website prompts include forced browser_check + report_to_evaluator sequence.
"""
import json
import re
from pathlib import Path

import pytest

pytest.importorskip("programming_agent", reason="run with PYTHONPATH=agent-harness")

from programming_agent import tool_loop  # noqa: E402
from programming_agent.tools import browser  # noqa: E402
from programming_agent.prompts import sections  # noqa: E402


# ---------- A/B: forced mutation ----------

class FakeModel:
    """Model that narrates instead of calling tools (the Qwen/Hermes failure mode)."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def chat(self, messages, tools=None, tool_choice=None, **kw):
        self.calls.append({"tool_choice": tool_choice})
        return self.replies.pop(0)


def prose_reply(text):
    return {"role": "assistant", "content": text, "tool_calls": None}


def tool_reply(name, args):
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [{"id": "t1", "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)}}],
    }


def test_loop_escalates_to_forced_tool_choice_on_prose():
    """After a prose-only turn, the next request must force tool_choice to write_file."""
    model = FakeModel([
        prose_reply("I will now write the file: {\"path\": \"app/page.tsx\"}"),
        tool_reply("write_file", {"path": "app/page.tsx", "content": "export default ..."}),
    ])
    result = tool_loop.run(model=model, prompt="make a pink calculator",
                           workspace={}, max_turns=4)  # adapt signature if needed
    forced = [c["tool_choice"] for c in model.calls[1:]]
    assert any(fc not in (None, "auto") for fc in forced), \
        "tool_choice never forced after prose-only turn"
    assert result.get("mutated") or result.get("files_written"), \
        "loop ended without any file mutation"


def test_hermes_prose_json_recovered_as_tool_call():
    """Prose containing a write_file JSON stub should be recovered into a real call."""
    prose = 'write_file({"path": "app/page.tsx", "content": "<div>pink</div>"})'
    recovered = tool_loop.recover_tool_call_from_prose(prose)
    assert recovered is not None
    assert recovered["name"] == "write_file"
    assert recovered["arguments"]["path"] == "app/page.tsx"


def test_scaffold_fallback_when_template_survives():
    ws = {"app/page.tsx": "/* Scaffolded by Manycat */ export default ..."}
    out = tool_loop.apply_scaffold_fallback(prompt="pink calculator", workspace=ws)
    assert "Scaffolded by Manycat" not in out["app/page.tsx"], \
        "fallback did not replace scaffold template"


# ---------- F: browser_check without preview URL ----------

def test_browser_check_skips_without_url():
    res = browser.browser_check(preview_url=None)
    assert res.get("status") == "skipped"
    text = json.dumps(res).lower()
    for bad in ("provide the url", "what is the url", "please share", "send me"):
        assert bad not in text, "browser_check asked the human for a URL"


def test_website_prompt_forces_qa_sequence():
    p = sections.website_section() if hasattr(sections, "website_section") else \
        "".join(v for v in vars(sections).values() if isinstance(v, str))
    assert "browser_check" in p and "report_to_evaluator" in p, \
        "website prompt section missing forced QA tools"
    assert re.search(r"read_app_logs", p), "logs tool not referenced in website prompt"
    assert "ask the user" not in p.lower() or "never ask" in p.lower()
