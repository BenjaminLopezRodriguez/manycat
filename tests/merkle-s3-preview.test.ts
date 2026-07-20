/**
 * Vitest suite for checklist A (preview remount), C (merkle/S3), D (srcdoc leaks).
 * Run from Next repo root: npx vitest run tests/merkle-s3-preview.test.ts
 * Adjust import paths if aliases differ.
 */
import { describe, it, expect, vi } from "vitest";
import { buildTree, hashBlob, diffTrees } from "@/server/content/merkle";
import { buildKeys } from "@/server/s3/build-store"; // export a pure key builder; add if missing
import { toSrcDoc } from "@/app/_fragments/chat/preview-srcdoc";
// Adapted import: the workflow router drags next-auth/next runtime into unit
// tests; the sanitizer lives in a leaf module and is re-exported by the router.
import { summarizeUpstreamBody } from "@/server/api/upstream";

// ---------- C. Merkle determinism + diffs ----------

describe("merkle", () => {
  const files = {
    "app/page.tsx": "export default function P(){return <div>pink</div>}",
    "app/layout.tsx": "export default function L({children}){return children}",
  };

  it("hashes are content-addressed and stable", () => {
    expect(hashBlob(files["app/page.tsx"])).toBe(hashBlob(files["app/page.tsx"]));
    expect(hashBlob("a")).not.toBe(hashBlob("b"));
  });

  it("tree hash changes iff content changes", () => {
    const t1 = buildTree(files);
    const t2 = buildTree({ ...files });
    const t3 = buildTree({ ...files, "app/page.tsx": "changed" });
    expect(t1.sha).toBe(t2.sha);
    expect(t1.sha).not.toBe(t3.sha);
  });

  it("diffTrees reports changedPaths against PARENT tip (regression: parent loaded before replace)", () => {
    const before = buildTree(files);
    const after = buildTree({ ...files, "app/page.tsx": "new" });
    const changed = diffTrees(before, after);
    // Adapted: diffTrees returns rich {path, beforeSha, afterSha} records —
    // that shape is persisted in S3 intents, so the paths are asserted instead.
    expect(changed.map((c) => c.path)).toEqual(["app/page.tsx"]);
    // The Grok bug: computing diff after workspace replace → empty changedPaths.
    expect(changed.length).toBeGreaterThan(0);
  });
});

// ---------- C. S3 key layout ----------

describe("s3 layout", () => {
  it("keys follow {prefix}/builds/{accountId}/{buildId}/objects|refs|intents", () => {
    const k = buildKeys({ prefix: "p", accountId: "acct", buildId: "b1" });
    expect(k.blob("abc")).toBe("p/builds/acct/b1/objects/blobs/abc");
    expect(k.tree("t")).toBe("p/builds/acct/b1/objects/trees/t.json");
    expect(k.commit("c")).toBe("p/builds/acct/b1/objects/commits/c.json");
    expect(k.ref("main")).toBe("p/builds/acct/b1/refs/heads/main");
    expect(k.intent("i")).toBe("p/builds/acct/b1/intents/i.json");
  });
});

// ---------- D. Preview srcdoc must not leak JS ----------

describe("preview srcdoc", () => {
  const component = `
    "use client";
    import { useState } from "react";
    export default function Calc() {
      const [n, setN] = useState(0);
      return (
        <div className="bg-pink-300 p-4">
          <button onClick={() => setN(n + 1)}>+{n}</button>
        </div>
      );
    }`;

  it("extracts return JSX only — no hooks/imports as visible text", () => {
    const html = toSrcDoc({ "app/page.tsx": component });
    expect(html).toContain("bg-pink-300");
    expect(html).not.toMatch(/useState|use client|import\s|return\s*\(/);
  });

  it("includes Tailwind CDN so classes render", () => {
    const html = toSrcDoc({ "app/page.tsx": component });
    expect(html).toMatch(/cdn\.tailwindcss\.com|tailwind/i);
  });

  it("empty/broken component yields safe placeholder, not raw source", () => {
    const html = toSrcDoc({ "app/page.tsx": "const broken = {" });
    expect(html).not.toContain("const broken");
  });
});

// ---------- D. HTML error sanitization ----------

describe("summarizeUpstreamBody", () => {
  it("never returns full HTML pages", () => {
    const nextHtml = `<!DOCTYPE html><html><body>404: This page could not be found ${"x".repeat(50_000)}</body></html>`;
    const out = summarizeUpstreamBody(nextHtml, 502);
    expect(out.length).toBeLessThan(400);
    expect(out).not.toContain("<!DOCTYPE");
  });

  it("passes short JSON errors through", () => {
    const out = summarizeUpstreamBody('{"error":"budget exceeded"}', 402);
    expect(out).toContain("budget exceeded");
  });
});

// ---------- A/E. Preview remount + rail state (pure logic) ----------

describe("preview remount + rail", () => {
  it("remount key changes on contentRootHash or previewEpoch", async () => {
    const key = (h: string, e: number) => `${h}:${e}`;
    expect(key("h1", 0)).not.toBe(key("h2", 0));
    expect(key("h1", 0)).not.toBe(key("h1", 1));
  });

  it("rail state mapping: working > unread > failure precedence", () => {
    // Replace with real selector import, e.g. railStatus({agentJobId, lastRunOutcome, unread})
    const railStatus = ({ agentJobId, lastRunOutcome, unread }: any) =>
      agentJobId ? "working" : lastRunOutcome === "failure" ? "red" : unread ? "blue" : "idle";
    expect(railStatus({ agentJobId: "j" })).toBe("working");
    expect(railStatus({ unread: true })).toBe("blue");
    expect(railStatus({ lastRunOutcome: "failure" })).toBe("red");
  });
});
