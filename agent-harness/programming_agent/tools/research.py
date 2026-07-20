"""Research brief tools — chunks, plan, and harness targets from websearch."""

from __future__ import annotations

import json
from typing import Any, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


class ReadResearchChunkInput(BaseModel):
    chunk_id: Optional[str] = Field(
        default=None,
        description="Chunk id (e.g. c0). Omit to get the next unread chunk.",
    )
    kind: Optional[str] = Field(
        default=None,
        description="Filter: identity | visual | ux | reference | constraint",
    )


class ReadResearchPlanInput(BaseModel):
    include_targets: bool = Field(
        default=True,
        description="Include acceptance targets in the response.",
    )


class ReadResearchTargetInput(BaseModel):
    target_id: Optional[str] = Field(
        default=None,
        description="Target id (e.g. t0). Omit to get the next unread target.",
    )
    harness: Optional[str] = Field(
        default=None,
        description="Filter: coder | eval | deploy_debug | browser | any",
    )


class ResearchBriefStore:
    """In-job store for chunked websearch brief + plan/targets (set once per job)."""

    def __init__(self, brief: Optional[dict[str, Any]] = None) -> None:
        self.brief = brief or {}
        self._served_chunks: set[str] = set()
        self._served_targets: set[str] = set()

    def summary(self) -> str:
        return str(self.brief.get("summary") or "")

    def chunks(self) -> list[dict[str, Any]]:
        raw = self.brief.get("chunks")
        return raw if isinstance(raw, list) else []

    def plan(self) -> dict[str, Any]:
        raw = self.brief.get("plan")
        return raw if isinstance(raw, dict) else {}

    def targets(self) -> list[dict[str, Any]]:
        plan = self.plan()
        raw = plan.get("targets")
        if isinstance(raw, list):
            return raw
        # Allow flat targets on brief for older payloads
        flat = self.brief.get("targets")
        return flat if isinstance(flat, list) else []

    def steps(self) -> list[dict[str, Any]]:
        raw = self.plan().get("steps")
        return raw if isinstance(raw, list) else []

    def read(
        self,
        chunk_id: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> dict[str, Any]:
        chunks = self.chunks()
        if not chunks:
            return {
                "ok": False,
                "error": "No research brief attached to this job.",
            }

        candidates = chunks
        if kind:
            candidates = [
                c for c in chunks if str(c.get("kind") or "") == kind
            ] or chunks

        chosen: Optional[dict[str, Any]] = None
        if chunk_id:
            for c in candidates:
                if str(c.get("id")) == chunk_id:
                    chosen = c
                    break
        else:
            for c in candidates:
                cid = str(c.get("id") or "")
                if cid and cid not in self._served_chunks:
                    chosen = c
                    break
            if chosen is None and candidates:
                chosen = candidates[0]

        if chosen is None:
            return {"ok": False, "error": "No matching research chunk."}

        cid = str(chosen.get("id") or "")
        if cid:
            self._served_chunks.add(cid)

        return {
            "ok": True,
            "chunk": chosen,
            "served": sorted(self._served_chunks),
            "remaining": [
                str(c.get("id"))
                for c in chunks
                if str(c.get("id")) not in self._served_chunks
            ],
            "summary": self.summary(),
        }

    def read_plan(self, include_targets: bool = True) -> dict[str, Any]:
        plan = self.plan()
        if not plan and not self.summary() and not self.chunks():
            return {
                "ok": False,
                "error": "No research plan attached to this job.",
            }
        if not plan:
            return {
                "ok": True,
                "goal": self.summary(),
                "productRef": "",
                "steps": [],
                "targets": self.targets() if include_targets else [],
                "outOfScope": [],
                "summary": self.summary(),
            }
        out: dict[str, Any] = {
            "ok": True,
            "goal": plan.get("goal") or self.summary(),
            "productRef": plan.get("productRef") or "",
            "steps": self.steps(),
            "outOfScope": plan.get("outOfScope") or [],
            "summary": self.summary(),
        }
        if include_targets:
            out["targets"] = self.targets()
        return out

    def read_target(
        self,
        target_id: Optional[str] = None,
        harness: Optional[str] = None,
    ) -> dict[str, Any]:
        targets = self.targets()
        if not targets:
            return {
                "ok": False,
                "error": "No research targets attached to this job.",
            }

        candidates = targets
        if harness:
            candidates = [
                t
                for t in targets
                if str(t.get("harness") or "") in (harness, "any")
            ] or targets

        chosen: Optional[dict[str, Any]] = None
        if target_id:
            for t in candidates:
                if str(t.get("id")) == target_id:
                    chosen = t
                    break
        else:
            for t in candidates:
                tid = str(t.get("id") or "")
                if tid and tid not in self._served_targets:
                    chosen = t
                    break
            if chosen is None and candidates:
                chosen = candidates[0]

        if chosen is None:
            return {"ok": False, "error": "No matching research target."}

        tid = str(chosen.get("id") or "")
        if tid:
            self._served_targets.add(tid)

        return {
            "ok": True,
            "target": chosen,
            "served": sorted(self._served_targets),
            "remaining": [
                str(t.get("id"))
                for t in targets
                if str(t.get("id")) not in self._served_targets
            ],
            "goal": self.plan().get("goal") or self.summary(),
        }


def make_research_tools(store: ResearchBriefStore) -> list[StructuredTool]:
    def read_research_chunk(
        chunk_id: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> str:
        return json.dumps(store.read(chunk_id=chunk_id, kind=kind), indent=2)

    def read_research_plan(include_targets: bool = True) -> str:
        return json.dumps(
            store.read_plan(include_targets=include_targets), indent=2
        )

    def read_research_target(
        target_id: Optional[str] = None,
        harness: Optional[str] = None,
    ) -> str:
        return json.dumps(
            store.read_target(target_id=target_id, harness=harness), indent=2
        )

    return [
        StructuredTool.from_function(
            func=read_research_chunk,
            name="read_research_chunk",
            description=(
                "Read the next (or specific) chunk from the websearch research "
                "brief. Use when you need more product/visual facts beyond the "
                "summary already in the prompt (e.g. Casio layout details)."
            ),
            args_schema=ReadResearchChunkInput,
            handle_tool_error=True,
        ),
        StructuredTool.from_function(
            func=read_research_plan,
            name="read_research_plan",
            description=(
                "Read the detailed build plan produced by the websearch harness: "
                "goal, ordered steps, out-of-scope, and acceptance targets for "
                "coder / eval / browser / deploy_debug."
            ),
            args_schema=ReadResearchPlanInput,
            handle_tool_error=True,
        ),
        StructuredTool.from_function(
            func=read_research_target,
            name="read_research_target",
            description=(
                "Read the next (or specific) acceptance target from the "
                "websearch plan. Filter by harness role (coder, eval, "
                "deploy_debug, browser) to see what you must satisfy."
            ),
            args_schema=ReadResearchTargetInput,
            handle_tool_error=True,
        ),
    ]
