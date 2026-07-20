import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";

import { env } from "@/env";
import {
  buildTree,
  diffTrees,
  hashCommit,
  type MerkleCommit,
  type MerklePathChange,
  type MerkleTree,
} from "@/server/content/merkle";
import type { ContentFile } from "@/server/content/store";

function s3Config() {
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    prefix: (env.S3_KEY_PREFIX ?? "create").replace(/^\/+|\/+$/g, ""),
  };
}

export function isBuildStoreConfigured(): boolean {
  return s3Config() != null;
}

function clientFor(cfg: NonNullable<ReturnType<typeof s3Config>>) {
  return new S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

function safeSeg(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128);
}

/** Pure S3 key layout: {prefix}/builds/{accountId}/{buildId}/objects|refs|intents */
export function buildKeys(opts: {
  prefix: string;
  accountId: string;
  buildId: string;
}) {
  const root = `${opts.prefix}/builds/${safeSeg(opts.accountId)}/${safeSeg(opts.buildId)}`;
  return {
    root,
    blob: (sha: string) => `${root}/objects/blobs/${sha}`,
    tree: (sha: string) => `${root}/objects/trees/${sha}.json`,
    commit: (sha: string) => `${root}/objects/commits/${sha}.json`,
    ref: (branch: string) => `${root}/refs/heads/${safeSeg(branch)}`,
    intent: (id: string) => `${root}/intents/${id}.json`,
  };
}

async function putText(
  cfg: NonNullable<ReturnType<typeof s3Config>>,
  key: string,
  body: string,
  contentType = "application/json",
) {
  const client = clientFor(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=31536000",
    }),
  );
}

async function getText(
  cfg: NonNullable<ReturnType<typeof s3Config>>,
  key: string,
): Promise<string | null> {
  const client = clientFor(cfg);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch {
    return null;
  }
}

export type BuildSnapshotResult = {
  commitSha: string;
  treeSha: string;
  parentCommitSha: string | null;
  intentId: string;
  changedPaths: MerklePathChange[];
  /** False when S3 is unset — local merkle only. */
  persistedToS3: boolean;
};

export type BuildIntentRecord = {
  intentId: string;
  prompt: string | null;
  thoughts: string | null;
  beforeCommit: string | null;
  afterCommit: string;
  treeSha: string;
  changedPaths: MerklePathChange[];
  createdAt: string;
};

/**
 * Commit a file snapshot into the build merkle store.
 * Layout: {prefix}/builds/{accountId}/{buildId}/objects|refs|intents
 */
export async function putBuildSnapshot(opts: {
  accountId: string;
  buildId: string;
  files: ContentFile[];
  branch?: string;
  prompt?: string | null;
  thoughts?: string | null;
  parentCommitSha?: string | null;
  /** Prior tree entries for diff (when parent commit not loaded). */
  parentTreeEntries?: Record<string, string> | null;
}): Promise<BuildSnapshotResult> {
  const branch = opts.branch ?? "main";
  const { tree, blobs } = buildTree(opts.files);
  const createdAt = new Date().toISOString();
  const parent =
    opts.parentCommitSha === undefined ? null : opts.parentCommitSha;

  const commitMeta = {
    parent,
    tree: tree.sha,
    prompt: opts.prompt ?? null,
    thoughts: opts.thoughts ?? null,
    createdAt,
  };
  const commitSha = hashCommit(commitMeta);
  const commit: MerkleCommit = { sha: commitSha, ...commitMeta };

  const parentEntries = opts.parentTreeEntries ?? null;
  const changedPaths = diffTrees(parentEntries, tree.entries);
  const intentId = randomBytes(12).toString("hex");
  const intent: BuildIntentRecord = {
    intentId,
    prompt: opts.prompt ?? null,
    thoughts: opts.thoughts ?? null,
    beforeCommit: parent,
    afterCommit: commitSha,
    treeSha: tree.sha,
    changedPaths,
    createdAt,
  };

  const cfg = s3Config();
  if (!cfg) {
    return {
      commitSha,
      treeSha: tree.sha,
      parentCommitSha: parent,
      intentId,
      changedPaths,
      persistedToS3: false,
    };
  }

  const keys = buildKeys({
    prefix: cfg.prefix,
    accountId: opts.accountId,
    buildId: opts.buildId,
  });

  await Promise.all(
    blobs.map((b) => putText(cfg, keys.blob(b.sha), b.contents, "text/plain")),
  );
  await putText(cfg, keys.tree(tree.sha), JSON.stringify(tree));
  await putText(cfg, keys.commit(commitSha), JSON.stringify(commit));
  await putText(cfg, keys.ref(branch), commitSha, "text/plain");
  await putText(cfg, keys.intent(intentId), JSON.stringify(intent));

  return {
    commitSha,
    treeSha: tree.sha,
    parentCommitSha: parent,
    intentId,
    changedPaths,
    persistedToS3: true,
  };
}

export async function getBuildTip(opts: {
  accountId: string;
  buildId: string;
  branch?: string;
}): Promise<{ commitSha: string; commit: MerkleCommit; tree: MerkleTree } | null> {
  const cfg = s3Config();
  if (!cfg) return null;
  const keys = buildKeys({
    prefix: cfg.prefix,
    accountId: opts.accountId,
    buildId: opts.buildId,
  });
  const branch = opts.branch ?? "main";
  const commitSha = (await getText(cfg, keys.ref(branch)))?.trim();
  if (!commitSha) return null;
  const commitRaw = await getText(cfg, keys.commit(commitSha));
  if (!commitRaw) return null;
  const commit = JSON.parse(commitRaw) as MerkleCommit;
  const treeRaw = await getText(cfg, keys.tree(commit.tree));
  if (!treeRaw) return null;
  const tree = JSON.parse(treeRaw) as MerkleTree;
  return { commitSha, commit, tree };
}

export async function getTreeEntriesFromTip(opts: {
  accountId: string;
  buildId: string;
}): Promise<Record<string, string> | null> {
  const tip = await getBuildTip(opts);
  return tip?.tree.entries ?? null;
}
