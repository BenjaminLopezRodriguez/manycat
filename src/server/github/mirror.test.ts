import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text: string, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("no json");
    },
    text: async () => text,
  };
}

describe("mirrorRepoName", () => {
  it("sanitizes and truncates account/workflow ids", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.resetModules();
    const { mirrorRepoName } = await import("./mirror");
    expect(mirrorRepoName("Acct_ONE!", "wf/Foo_Bar")).toBe("mc-acct-one--wf-foo-bar");
  });
});

describe("ensureMirroredRepo", () => {
  it("throws when GITHUB_MIRROR_TOKEN/ORG missing", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("GITHUB_MIRROR_TOKEN", "");
    vi.stubEnv("GITHUB_MIRROR_ORG", "");
    vi.resetModules();
    const { ensureMirroredRepo } = await import("./mirror");

    await expect(
      ensureMirroredRepo({
        accountId: "a1",
        workflowId: "w1",
        files: [{ path: "README.md", contents: "hi" }],
      }),
    ).rejects.toThrow(/GitHub mirror not configured|org-scoped/i);
  });

  it("creates repo on 404 and pushes via Git Data API with Authorization + org", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("GITHUB_MIRROR_TOKEN", "mirror-token-xyz");
    vi.stubEnv("GITHUB_MIRROR_ORG", "manycat-apps");

    const calls: { url: string; method: string; auth?: string | null }[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method,
        auth: headers.get("Authorization"),
      });

      if (method === "GET" && url.endsWith("/repos/manycat-apps/mc-a1-w1")) {
        return textResponse("Not Found", 404);
      }
      if (method === "POST" && url.endsWith("/orgs/manycat-apps/repos")) {
        return jsonResponse({ full_name: "manycat-apps/mc-a1-w1" }, 201);
      }
      if (
        method === "GET" &&
        url.includes("/repos/manycat-apps/mc-a1-w1/git/ref/heads/main")
      ) {
        return jsonResponse({ object: { sha: "parentcommitsha" } });
      }
      if (
        method === "GET" &&
        url.includes("/repos/manycat-apps/mc-a1-w1/git/commits/parentcommitsha")
      ) {
        return jsonResponse({ tree: { sha: "parenttreesha" } });
      }
      if (method === "POST" && url.endsWith("/git/blobs")) {
        return jsonResponse({ sha: "blobsha1" }, 201);
      }
      if (method === "POST" && url.endsWith("/git/trees")) {
        return jsonResponse({ sha: "newtreesha" }, 201);
      }
      if (method === "POST" && url.endsWith("/git/commits")) {
        return jsonResponse({ sha: "newcommitsha" }, 201);
      }
      if (
        method === "PATCH" &&
        url.includes("/git/refs/heads/main")
      ) {
        return jsonResponse({ ref: "refs/heads/main" });
      }
      return textResponse(`unexpected ${method} ${url}`, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ensureMirroredRepo } = await import("./mirror");

    const result = await ensureMirroredRepo({
      accountId: "a1",
      workflowId: "w1",
      files: [
        { path: "package.json", contents: '{"name":"app"}' },
        { path: "app/page.tsx", contents: "export default function Page(){return null}" },
      ],
    });

    expect(result).toEqual({ mirrorGithubRepo: "manycat-apps/mc-a1-w1" });

    expect(calls.some((c) => c.url.includes("/orgs/manycat-apps/repos"))).toBe(
      true,
    );
    expect(calls.every((c) => c.auth === "Bearer mirror-token-xyz")).toBe(true);
    expect(calls.some((c) => c.url.includes("/git/blobs"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/git/trees"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/git/commits"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/git/refs/heads/main"))).toBe(
      true,
    );

    const createBody = JSON.parse(
      String(
        fetchMock.mock.calls.find(
          ([u, i]) =>
            String(u).endsWith("/orgs/manycat-apps/repos") &&
            (i as RequestInit | undefined)?.method === "POST",
        )?.[1]?.body,
      ),
    ) as { name: string; private: boolean; auto_init: boolean };
    expect(createBody).toMatchObject({
      name: "mc-a1-w1",
      private: true,
      auto_init: true,
    });
  });

  it("reuses existingMirrorRepo name and skips create when repo exists", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("GITHUB_MIRROR_TOKEN", "tok");
    vi.stubEnv("GITHUB_MIRROR_ORG", "manycat-apps");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.endsWith("/repos/manycat-apps/existing-repo")) {
        return jsonResponse({ full_name: "manycat-apps/existing-repo" });
      }
      if (url.includes("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "p" } });
      }
      if (url.includes("/git/commits/p")) {
        return jsonResponse({ tree: { sha: "t" } });
      }
      if (url.endsWith("/git/blobs")) return jsonResponse({ sha: "b" }, 201);
      if (url.endsWith("/git/trees")) return jsonResponse({ sha: "nt" }, 201);
      if (url.endsWith("/git/commits")) return jsonResponse({ sha: "nc" }, 201);
      if (url.includes("/git/refs/heads/main") && method === "PATCH") {
        return jsonResponse({});
      }
      return textResponse(`unexpected ${method} ${url}`, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ensureMirroredRepo } = await import("./mirror");

    const result = await ensureMirroredRepo({
      accountId: "a1",
      workflowId: "w1",
      files: [{ path: "a.txt", contents: "x" }],
      existingMirrorRepo: "manycat-apps/existing-repo",
    });

    expect(result.mirrorGithubRepo).toBe("manycat-apps/existing-repo");
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes("/orgs/manycat-apps/repos"),
      ),
    ).toBe(false);
  });

  it("throws on Git Data API failure", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("GITHUB_MIRROR_TOKEN", "tok");
    vi.stubEnv("GITHUB_MIRROR_ORG", "manycat-apps");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/manycat-apps/mc-a-w")) {
        return jsonResponse({ full_name: "manycat-apps/mc-a-w" });
      }
      if (url.includes("/git/ref/heads/main")) {
        return textResponse("ref boom", 500);
      }
      return textResponse("unexpected", 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ensureMirroredRepo } = await import("./mirror");

    await expect(
      ensureMirroredRepo({
        accountId: "a",
        workflowId: "w",
        files: [{ path: "a.txt", contents: "x" }],
      }),
    ).rejects.toThrow(/get ref failed|ref boom/i);
  });
});
