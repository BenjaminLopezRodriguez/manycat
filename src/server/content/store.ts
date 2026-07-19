/**
 * ContentStore seam — GitHub/sandbox + S3 merkle (build store).
 * Control plane keeps tips/intents in Postgres; S3 owns blobs/trees/commits.
 */

export type ContentBackend = "github" | "virtual";

export type ContentFile = {
  path: string;
  contents: string;
};

export type ContentCommit = {
  parent?: string | null;
  treeHash?: string | null;
  diff?: string | null;
  prompt?: string | null;
  templateId?: string | null;
  accountId: string;
  workflowId: string;
  createdAt: Date;
};

export type ContentStore = {
  backend: ContentBackend;
  listFiles(accountId: string, workflowId: string): Promise<ContentFile[]>;
  /**
   * Reserved for virtual-git commits (prompt-linked).
   * GitHub backend is a no-op until Phase 4.
   */
  recordChange?(change: ContentCommit): Promise<void>;
};

/** GitHub-import path: files live in the sandbox orchestrator workspace. */
export function createGitHubContentStore(opts: {
  fetchFiles: (workflowId: string) => Promise<ContentFile[]>;
}): ContentStore {
  return {
    backend: "github",
    async listFiles(_accountId, workflowId) {
      return opts.fetchFiles(workflowId);
    },
    async recordChange() {
      // GitHub path: no S3 merkle commit (virtual builds use putBuildSnapshot).
    },
  };
}
