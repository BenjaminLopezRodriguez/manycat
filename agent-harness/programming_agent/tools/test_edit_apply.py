"""Unit tests for Aider-style edit_file apply (stdlib unittest — no pytest required)."""

from __future__ import annotations

import unittest

from programming_agent.tools.edit_apply import apply_search_replace


class TestApplySearchReplace(unittest.TestCase):
    def test_exact_match(self) -> None:
        text = "function hello() {\n  return 1;\n}\n"
        r = apply_search_replace(text, "return 1;", "return 2;")
        self.assertTrue(r.ok)
        self.assertEqual(r.match_kind, "exact")
        self.assertIn("return 2;", r.text or "")

    def test_whitespace_tolerant(self) -> None:
        text = "export default function Page() {\n  return <div>Hi</div>\n}\n"
        old = "export default function Page() {\nreturn <div>Hi</div>\n}"
        r = apply_search_replace(text, old, "export default function Page() {\n  return <div>Yo</div>\n}")
        self.assertTrue(r.ok, r.error)
        self.assertEqual(r.match_kind, "whitespace")
        self.assertIn("Yo", r.text or "")

    def test_unescape_literals(self) -> None:
        text = "a\nb\n"
        # Model sent literal backslash-n in old_string JSON
        r = apply_search_replace(text, "a\\nb", "a\nc")
        self.assertTrue(r.ok, r.error)
        self.assertEqual(r.match_kind, "unescape")
        self.assertEqual(r.text, "a\nc\n")

    def test_mismatch_returns_error_with_context_no_silent_overwrite(self) -> None:
        text = "line one\nline two\nline three\n"
        big_new = "x" * 80
        r = apply_search_replace(text, "does not exist anywhere", big_new)
        self.assertFalse(r.ok)
        self.assertIsNone(r.text)
        self.assertIn("Error: old_string not found", r.error or "")
        self.assertIn("Nearby file context", r.error or "")
        self.assertIn("line one", r.error or "")

    def test_ambiguous_requires_replace_all(self) -> None:
        text = "foo\nbar\nfoo\n"
        r = apply_search_replace(text, "foo", "baz")
        self.assertFalse(r.ok)
        self.assertIn("appears 2 times", r.error or "")
        r2 = apply_search_replace(text, "foo", "baz", replace_all=True)
        self.assertTrue(r2.ok)
        self.assertEqual(r2.text, "baz\nbar\nbaz\n")

    def test_empty_old_string_errors(self) -> None:
        r = apply_search_replace("hi", "   ", "bye")
        self.assertFalse(r.ok)
        self.assertIn("empty", (r.error or "").lower())


if __name__ == "__main__":
    unittest.main()
