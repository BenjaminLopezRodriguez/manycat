import { env } from "@/env";
import type { ContentFile } from "@/server/content/store";

/**
 * Mirror virtual workspace files into a Manycat-owned GitHub org repo.
 *
 * GITHUB_MIRROR_TOKEN must be a GitHub App installation token or fine-grained
 * PAT scoped to GITHUB_MIRROR_ORG only — never a classic PAT on a personal
 * account. This token pushes user-generated code; blast radius must not
 * include personal repos.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export function mirrorRepoName(accountId: string, workflowId: string) {
  const a = accountId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
  const w = workflowId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 30);
  return `mc-${a}-${w}`.slice(0, 100);
}

function authHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "Content-Type": "application/json",
  };
}

async function ghJson<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; status: number; body: T } | { ok: false; status: number; text: string }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(token),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, text: await res.text() };
  }
  if (res.status === 204) {
    return { ok: true, status: 204, body: undefined as T };
  }
  return { ok: true, status: res.status, body: (await res.json()) as T };
}

async function ensureRepoExists(
  token: string,
  org: string,
  name: string,
): Promise<void> {
  const get = await ghJson<unknown>(token, `/repos/${org}/${name}`);
  if (get.ok) return;
  if (get.status !== 404) {
    throw new Error(`GitHub mirror GET repo failed (${get.status}): ${get.text}`);
  }

  const create = await ghJson<{ full_name: string }>(
    token,
    `/orgs/${org}/repos`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        private: true,
        auto_init: true,
      }),
    },
  );
  if (!create.ok) {
    throw new Error(
      `GitHub mirror create repo failed (${create.status}): ${create.text}`,
    );
  }
}

async function pushTreeViaGitDataApi(
  token: string,
  org: string,
  name: string,
  files: ContentFile[],
): Promise<void> {
  const ref = await ghJson<{ object: { sha: string } }>(
    token,
    `/repos/${org}/${name}/git/ref/heads/main`,
  );
  if (!ref.ok) {
    throw new Error(
      `GitHub mirror get ref failed (${ref.status}): ${ref.text}`,
    );
  }
  const parentSha = ref.body.object.sha;

  const parentCommit = await ghJson<{ tree: { sha: string } }>(
    token,
    `/repos/${org}/${name}/git/commits/${parentSha}`,
  );
  if (!parentCommit.ok) {
    throw new Error(
      `GitHub mirror get commit failed (${parentCommit.status}): ${parentCommit.text}`,
    );
  }

  const blobShas: { path: string; sha: string }[] = [];
  for (const file of files) {
    const blob = await ghJson<{ sha: string }>(
      token,
      `/repos/${org}/${name}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({
          content: file.contents,
          encoding: "utf-8",
        }),
      },
    );
    if (!blob.ok) {
      throw new Error(
        `GitHub mirror create blob failed (${blob.status}): ${blob.text}`,
      );
    }
    blobShas.push({ path: file.path, sha: blob.body.sha });
  }

  // Full-tree replace (no base_tree) so the mirror matches `files` exactly.
  const tree = await ghJson<{ sha: string }>(
    token,
    `/repos/${org}/${name}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        tree: blobShas.map((b) => ({
          path: b.path,
          mode: "100644",
          type: "blob",
          sha: b.sha,
        })),
      }),
    },
  );
  if (!tree.ok) {
    throw new Error(
      `GitHub mirror create tree failed (${tree.status}): ${tree.text}`,
    );
  }

  const commit = await ghJson<{ sha: string }>(
    token,
    `/repos/${org}/${name}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "Mirror workspace from Manycat",
        tree: tree.body.sha,
        parents: [parentSha],
      }),
    },
  );
  if (!commit.ok) {
    throw new Error(
      `GitHub mirror create commit failed (${commit.status}): ${commit.text}`,
    );
  }

  const updateRef = await ghJson<unknown>(
    token,
    `/repos/${org}/${name}/git/refs/heads/main`,
    {
      method: "PATCH",
      body: JSON.stringify({
        sha: commit.body.sha,
        force: true,
      }),
    },
  );
  if (!updateRef.ok) {
    throw new Error(
      `GitHub mirror update ref failed (${updateRef.status}): ${updateRef.text}`,
    );
  }
}

export async function ensureMirroredRepo(opts: {
  accountId: string;
  workflowId: string;
  files: ContentFile[];
  existingMirrorRepo?: string | null;
}): Promise<{ mirrorGithubRepo: string }> {
  const token = env.GITHUB_MIRROR_TOKEN;
  const org = env.GITHUB_MIRROR_ORG;
  if (!token || !org) {
    throw new Error(
      "GitHub mirror not configured — set GITHUB_MIRROR_TOKEN (org-scoped) and GITHUB_MIRROR_ORG.",
    );
  }
  const name =
    opts.existingMirrorRepo?.split("/")[1] ??
    mirrorRepoName(opts.accountId, opts.workflowId);
  const full = `${org}/${name}`;

  await ensureRepoExists(token, org, name);
  await pushTreeViaGitDataApi(token, org, name, opts.files);

  return { mirrorGithubRepo: full };
}
