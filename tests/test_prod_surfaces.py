"""Prod surface tests for many.cat Build mode (checklist B, D, F, G).

Run: pytest tests/test_prod_surfaces.py -v
Env overrides: AGENT_HARNESS_URL, ORCHESTRATOR_URL, APP_URL
"""
import json
import os
import uuid

import pytest
import requests

HARNESS = os.environ.get(
    "AGENT_HARNESS_URL", "https://agent-harness-production-b567.up.railway.app"
).rstrip("/")
APP = os.environ.get("APP_URL", "https://www.many.cat").rstrip("/")
ORCH = os.environ.get("ORCHESTRATOR_URL", "").rstrip("/")

TIMEOUT = 30


# ---------- B. Tool calling / harness identity ----------

class TestHarnessHealth:
    def test_health_is_json_not_next_html(self):
        """G/B: Railway must serve FastAPI, not the Next.js monorepo 404."""
        r = requests.get(f"{HARNESS}/health", timeout=TIMEOUT)
        assert r.status_code == 200, f"/health returned {r.status_code}"
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct, f"content-type was {ct!r} — Next app leak?"
        body = r.json()
        assert body.get("status") == "ok", f"unexpected health body: {body}"
        assert "<!DOCTYPE" not in r.text and "__next" not in r.text

    def test_health_never_contains_next_markers(self):
        r = requests.get(f"{HARNESS}/health", timeout=TIMEOUT)
        for marker in ("_next/static", "next.js", "404: This page could not be found"):
            assert marker.lower() not in r.text.lower(), f"Next marker {marker!r} in /health"


class TestJobsApi:
    def test_jobs_post_returns_job_id(self):
        """B: POST /jobs accepted and returns job_id (background job created)."""
        payload = {
            "prompt": "smoke-test: no-op",
            "workflow_id": f"verify-{uuid.uuid4()}",
            "dry_run": True,
        }
        r = requests.post(f"{HARNESS}/jobs", json=payload, timeout=TIMEOUT)
        # 200/201/202 acceptable; 422 means schema drift — fail loudly with body.
        assert r.status_code in (200, 201, 202), f"{r.status_code}: {r.text[:500]}"
        body = r.json()
        assert "job_id" in body, f"no job_id in {body}"
        # Cleanup / cancel path also exercises POST /jobs/:id/cancel
        jid = body["job_id"]
        rc = requests.post(f"{HARNESS}/jobs/{jid}/cancel", timeout=TIMEOUT)
        assert rc.status_code in (200, 202, 404, 409), rc.text[:300]

    def test_jobs_get_unknown_is_json_error(self):
        r = requests.get(f"{HARNESS}/jobs/does-not-exist-{uuid.uuid4()}", timeout=TIMEOUT)
        assert r.status_code in (404, 400)
        assert "application/json" in r.headers.get("content-type", ""), \
            "error responses must be JSON, never HTML dumped to chat"


# ---------- D. Error sanitization ----------

class TestErrorSanitization:
    def test_harness_404_not_full_html_page(self):
        """D: upstream errors must never be full HTML pages (summarizeUpstreamBody)."""
        r = requests.get(f"{HARNESS}/definitely-not-a-route-{uuid.uuid4()}", timeout=TIMEOUT)
        assert "<!DOCTYPE" not in r.text, "harness serving HTML — wrong deploy root"
        assert len(r.text) < 5000, "error body suspiciously large (HTML dump?)"


# ---------- F. Orchestrator logs endpoint ----------

@pytest.mark.skipif(not ORCH, reason="ORCHESTRATOR_URL not set")
class TestOrchestrator:
    def test_logs_endpoint_shape(self):
        r = requests.get(f"{ORCH}/sandboxes/nonexistent/logs", timeout=TIMEOUT)
        assert r.status_code in (404, 400, 200)
        assert "<!DOCTYPE" not in r.text


# ---------- App reachable ----------

class TestApp:
    def test_app_up(self):
        r = requests.get(APP, timeout=TIMEOUT)
        assert r.status_code == 200
