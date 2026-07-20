"""
Aider-style SEARCH/REPLACE apply helpers for edit_file.

Match order: exact → unescape literal \\n → CRLF normalize → whitespace-tolerant.
Never silently no-op or overwrite on mismatch — return structured errors with context.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class EditApplyResult:
    ok: bool
    text: Optional[str] = None
    error: Optional[str] = None
    match_kind: Optional[str] = None


def _unescape_literals(s: str) -> str:
    if "\\n" not in s and "\\t" not in s:
        return s
    return s.replace("\\n", "\n").replace("\\t", "\t")


def _norm_newlines(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def _ws_tolerant_key(s: str) -> str:
    """Collapse horizontal whitespace; keep newlines as structural anchors."""
    lines = _norm_newlines(s).split("\n")
    return "\n".join(" ".join(line.split()) for line in lines)


def _find_ws_tolerant(haystack: str, needle: str) -> Optional[str]:
    """Return the exact haystack substring that matches needle under ws-tolerant rules."""
    h = _norm_newlines(haystack)
    n_key = _ws_tolerant_key(needle)
    if not n_key.strip():
        return None
    h_lines = h.split("\n")
    n_lines = _norm_newlines(needle).split("\n")
    if not n_lines:
        return None
    # Sliding window over line counts
    window = len(n_lines)
    for i in range(0, max(0, len(h_lines) - window + 1)):
        chunk_lines = h_lines[i : i + window]
        chunk = "\n".join(chunk_lines)
        if _ws_tolerant_key(chunk) == n_key:
            return chunk
    return None


def _context_snippet(text: str, old_string: str, radius: int = 2) -> str:
    """Best-effort nearby lines for ACI-style error messages."""
    text_n = _norm_newlines(text)
    lines = text_n.split("\n")
    first = (_norm_newlines(old_string).strip().split("\n") or [""])[0].strip()
    idx = -1
    if first:
        key = " ".join(first.split())
        for i, line in enumerate(lines):
            if key and key in " ".join(line.split()):
                idx = i
                break
    if idx < 0:
        # Show file head
        head = "\n".join(f"{i + 1:>4}|{lines[i]}" for i in range(min(8, len(lines))))
        return head or "(empty file)"
    start = max(0, idx - radius)
    end = min(len(lines), idx + radius + 1)
    return "\n".join(f"{i + 1:>4}|{lines[i]}" for i in range(start, end))


def apply_search_replace(
    text: str,
    old_string: str,
    new_string: str,
    *,
    replace_all: bool = False,
) -> EditApplyResult:
    if not (old_string or "").strip():
        return EditApplyResult(
            ok=False,
            error="Error: old_string is empty. Use write_file to create/overwrite, "
            "or provide an exact substring to replace.",
        )

    candidates: list[tuple[str, str]] = [
        (old_string, "exact"),
        (_unescape_literals(old_string), "unescape"),
        (_norm_newlines(old_string), "crlf"),
        (_norm_newlines(_unescape_literals(old_string)), "unescape+crlf"),
    ]

    matched: Optional[str] = None
    kind: Optional[str] = None
    for cand, label in candidates:
        if cand and cand in text:
            matched = cand
            kind = label
            break

    if matched is None:
        ws_hit = _find_ws_tolerant(text, old_string)
        if ws_hit is None:
            ws_hit = _find_ws_tolerant(text, _unescape_literals(old_string))
        if ws_hit is not None:
            matched = ws_hit
            kind = "whitespace"

    if matched is None:
        ctx = _context_snippet(text, old_string)
        preview = old_string[:120].replace("\n", "\\n")
        return EditApplyResult(
            ok=False,
            error=(
                "Error: old_string not found in file (tried exact, newline, "
                "and whitespace-tolerant match).\n"
                f"Looking for: {preview!r}\n"
                f"Nearby file context:\n{ctx}\n"
                "Re-read the file and call edit_file with an exact substring, "
                "or write_file for a full-file rewrite."
            ),
        )

    count = text.count(matched)
    if count > 1 and not replace_all:
        return EditApplyResult(
            ok=False,
            error=(
                f"Error: old_string appears {count} times; "
                "set replace_all=true or provide more unique context."
            ),
        )

    if replace_all:
        updated = text.replace(matched, new_string)
    else:
        updated = text.replace(matched, new_string, 1)

    return EditApplyResult(ok=True, text=updated, match_kind=kind)
