"""Lightweight static code graph for budgeted generator context."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

SKIP_DIRS = {".git", "node_modules", ".next", "__pycache__", ".venv", "dist", "build"}
MAX_FILE_BYTES = 80_000
CHUNK_FILES = 12
DEFAULT_BUDGET_CHARS = 10_000
DEFAULT_HOPS = 2

IMPORT_RE = re.compile(
    r"""(?:import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?|export\s+.+\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]""",
)


def _should_skip(rel: str) -> bool:
    parts = rel.replace("\\", "/").split("/")
    if any(p in SKIP_DIRS for p in parts):
        return True
    if rel.endswith((".lock", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico")):
        return True
    return False


def walk_source_files(root: Path) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for dirpath, dirnames, filenames in __import__("os").walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            full = Path(dirpath) / name
            rel = full.relative_to(root).as_posix()
            if _should_skip(rel):
                continue
            try:
                if full.stat().st_size > MAX_FILE_BYTES:
                    continue
                text = full.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            out.append((rel, text))
    return sorted(out, key=lambda x: x[0])


def _resolve_import(from_path: str, spec: str, all_paths: set[str]) -> str | None:
    if not spec.startswith("."):
        return None
    base = Path(from_path).parent / spec
    candidates = [
        base.as_posix(),
        f"{base.as_posix()}.ts",
        f"{base.as_posix()}.tsx",
        f"{base.as_posix()}.js",
        f"{base.as_posix()}.jsx",
        f"{base.as_posix()}/index.ts",
        f"{base.as_posix()}/index.tsx",
    ]
    for c in candidates:
        norm = Path(c).as_posix()
        if norm in all_paths:
            return norm
    return None


def build_index(files: list[tuple[str, str]]) -> dict[str, Any]:
    all_paths = {p for p, _ in files}
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, str]] = []

    def add_file(path: str) -> str:
        nid = f"file:{path}"
        nodes[nid] = {"id": nid, "kind": "file", "label": path, "path": path}
        return nid

    for path, text in files:
        fid = add_file(path)
        if path.startswith("app/") and path.endswith(
            ("page.tsx", "page.jsx", "page.ts", "page.js", "layout.tsx", "route.ts")
        ):
            rid = f"route:{path}"
            nodes[rid] = {"id": rid, "kind": "route", "label": path, "path": path}
            edges.append(
                {"id": f"e:{fid}->{rid}", "from": fid, "to": rid, "kind": "defines_route"}
            )
        if path == "package.json":
            try:
                pkg = json.loads(text)
            except json.JSONDecodeError:
                pkg = {}
            for section in ("dependencies", "devDependencies"):
                for name in (pkg.get(section) or {}):
                    did = f"dependency:{name}"
                    nodes[did] = {
                        "id": did,
                        "kind": "dependency",
                        "label": name,
                    }
                    edges.append(
                        {
                            "id": f"e:{fid}->{did}",
                            "from": fid,
                            "to": did,
                            "kind": "depends_on_pkg",
                        }
                    )
        for match in IMPORT_RE.finditer(text):
            spec = match.group(1)
            target = _resolve_import(path, spec, all_paths)
            if not target:
                continue
            tid = add_file(target)
            edges.append(
                {
                    "id": f"e:{fid}->{tid}:imports",
                    "from": fid,
                    "to": tid,
                    "kind": "imports",
                }
            )

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "pathToNodeIds": {
            n["path"]: [n["id"]] for n in nodes.values() if n.get("path")
        },
    }


def slice_graph(
    index: dict[str, Any],
    seeds: list[str],
    hops: int = DEFAULT_HOPS,
    budget_chars: int = DEFAULT_BUDGET_CHARS,
) -> dict[str, Any]:
    node_map = {n["id"]: n for n in index.get("nodes", [])}
    path_to = index.get("pathToNodeIds") or {}
    seed_ids: set[str] = set()
    for seed in seeds:
        if seed in node_map:
            seed_ids.add(seed)
            continue
        for nid in path_to.get(seed, []):
            seed_ids.add(nid)
        seed_ids.add(f"file:{seed}")

    visited = set(seed_ids)
    frontier = list(seed_ids)
    edges = index.get("edges") or []
    for _ in range(max(0, hops)):
        nxt: list[str] = []
        for nid in frontier:
            for e in edges:
                if e["from"] == nid and e["to"] not in visited:
                    visited.add(e["to"])
                    nxt.append(e["to"])
                if e["to"] == nid and e["from"] not in visited:
                    visited.add(e["from"])
                    nxt.append(e["from"])
        frontier = nxt

    out_nodes: list[dict[str, Any]] = []
    out_edges: list[dict[str, Any]] = []
    used = len(json.dumps({"seeds": seeds}))
    for nid in sorted(visited):
        n = node_map.get(nid)
        if not n:
            continue
        ser = json.dumps(n)
        if used + len(ser) > budget_chars:
            break
        out_nodes.append(n)
        used += len(ser)
    included = {n["id"] for n in out_nodes}
    for e in edges:
        if e["from"] not in included or e["to"] not in included:
            continue
        ser = json.dumps(e)
        if used + len(ser) > budget_chars:
            break
        out_edges.append(e)
        used += len(ser)

    summary_parts = [n.get("path") or n.get("label") for n in out_nodes[:12]]
    return {
        "seeds": seeds,
        "nodes": out_nodes,
        "edges": out_edges,
        "summary": ", ".join(str(p) for p in summary_parts if p)[:400],
    }


def graph_from_workspace(
    root: Path,
    seeds: list[str] | None = None,
    hops: int = DEFAULT_HOPS,
    budget_chars: int = DEFAULT_BUDGET_CHARS,
) -> dict[str, Any]:
    files = walk_source_files(root)
    index = build_index(files)
    seed_list = seeds or ["app/page.tsx", "package.json"]
    return slice_graph(index, seed_list, hops=hops, budget_chars=budget_chars)


# --- Compact text repo map (first-turn structural context) -----------------

SYMBOL_RE = re.compile(
    r"^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:async[ \t]+)?"
    r"(?:function|class|const|let|var|def)[ \t]+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)


def _symbols(text: str, limit: int = 6) -> list[str]:
    out: list[str] = []
    for m in SYMBOL_RE.finditer(text):
        name = m.group(1)
        if name not in out:
            out.append(name)
        if len(out) >= limit:
            break
    return out


def _import_specs(text: str, limit: int = 4) -> list[str]:
    out: list[str] = []
    for m in IMPORT_RE.finditer(text):
        spec = m.group(1)
        if spec not in out:
            out.append(spec)
        if len(out) >= limit:
            break
    return out


def _map_line(path: str, text: str, degree: int) -> str:
    parts = [f"{path} (deg {degree})"]
    syms = _symbols(text)
    if syms:
        parts.append("def: " + ", ".join(syms))
    imps = _import_specs(text)
    if imps:
        parts.append("imports: " + ", ".join(imps))
    return "  |  ".join(parts)


def render_repo_map(
    workspace: Path,
    seeds: list[str] | None = None,
    budget_chars: int = 6000,
) -> str:
    """Compact per-file symbol/import map for the agent's first turn.

    Files are ordered seeds-first, then by import degree (in+out edges from the
    static index — degree ranking, no PageRank). Rendered lines are truncated to
    ``budget_chars``. Empty workspace → "" (caller skips)."""
    files = walk_source_files(workspace)
    if not files:
        return ""
    text_by_path = dict(files)
    index = build_index(files)

    deg: dict[str, int] = {}
    for e in index.get("edges", []):
        for endpoint in (e.get("from", ""), e.get("to", "")):
            if endpoint.startswith("file:"):
                p = endpoint[len("file:"):]
                deg[p] = deg.get(p, 0) + 1

    seed_list = [s for s in (seeds or []) if s in text_by_path]
    seen = set(seed_list)
    by_deg = sorted(
        (p for p, _ in files if p not in seen),
        key=lambda p: (-deg.get(p, 0), p),
    )
    order = seed_list + by_deg

    header = "REPO MAP (top files by import degree):"
    lines = [header]
    used = len(header) + 1
    for path in order:
        line = _map_line(path, text_by_path[path], deg.get(path, 0))
        if used + len(line) + 1 > budget_chars:
            break
        lines.append(line)
        used += len(line) + 1
    if len(lines) == 1:
        return ""
    return "\n".join(lines)
