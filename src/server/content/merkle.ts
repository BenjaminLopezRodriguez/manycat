import { createHash } from "node:crypto";

import type { ContentFile } from "@/server/content/store";

export type MerkleBlob = {
  sha: string;
  contents: string;
};

export type MerkleTreeEntry =
  | { kind: "blob"; path: string; sha: string }
  | { kind: "tree"; path: string; sha: string };

export type MerkleTree = {
  sha: string;
  /** Flat path → blob sha (git-like single-level tree for app workspaces). */
  entries: Record<string, string>;
};

export type MerkleCommit = {
  sha: string;
  parent: string | null;
  tree: string;
  prompt: string | null;
  thoughts: string | null;
  createdAt: string;
};

export type MerklePathChange = {
  path: string;
  beforeSha: string | null;
  afterSha: string | null;
};

export function hashBlob(contents: string): string {
  return createHash("sha256").update("blob\0").update(contents).digest("hex");
}

/** Deterministic tree hash from sorted path→blobSha pairs. */
export function hashTreeEntries(entries: Record<string, string>): string {
  const h = createHash("sha256");
  h.update("tree\0");
  for (const path of Object.keys(entries).sort()) {
    h.update(path);
    h.update("\0");
    h.update(entries[path]!);
    h.update("\0");
  }
  return h.digest("hex");
}

export function hashCommit(input: {
  parent: string | null;
  tree: string;
  prompt: string | null;
  thoughts: string | null;
  createdAt: string;
}): string {
  const h = createHash("sha256");
  h.update("commit\0");
  h.update(input.parent ?? "");
  h.update("\0");
  h.update(input.tree);
  h.update("\0");
  h.update(input.prompt ?? "");
  h.update("\0");
  h.update(input.thoughts ?? "");
  h.update("\0");
  h.update(input.createdAt);
  return h.digest("hex");
}

export function buildTree(files: ContentFile[]): {
  tree: MerkleTree;
  blobs: MerkleBlob[];
} {
  const entries: Record<string, string> = {};
  const blobs: MerkleBlob[] = [];
  const seen = new Set<string>();

  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const sha = hashBlob(f.contents);
    entries[f.path] = sha;
    if (!seen.has(sha)) {
      seen.add(sha);
      blobs.push({ sha, contents: f.contents });
    }
  }

  const treeSha = hashTreeEntries(entries);
  return { tree: { sha: treeSha, entries }, blobs };
}

/** Root hash of a file tree (content-addressed). Replaces flat concat hash. */
export function merkleRoot(files: ContentFile[]): string {
  return buildTree(files).tree.sha;
}

export function diffTrees(
  before: Record<string, string> | null | undefined,
  after: Record<string, string>,
): MerklePathChange[] {
  const prev = before ?? {};
  const paths = new Set([...Object.keys(prev), ...Object.keys(after)]);
  const changes: MerklePathChange[] = [];
  for (const path of [...paths].sort()) {
    const beforeSha = prev[path] ?? null;
    const afterSha = after[path] ?? null;
    if (beforeSha === afterSha) continue;
    changes.push({ path, beforeSha, afterSha });
  }
  return changes;
}

export function filesFromBlobs(
  entries: Record<string, string>,
  blobs: Map<string, string>,
): ContentFile[] {
  const files: ContentFile[] = [];
  for (const [path, sha] of Object.entries(entries)) {
    const contents = blobs.get(sha);
    if (contents == null) continue;
    files.push({ path, contents });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
