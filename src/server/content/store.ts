/**
 * ContentStore seam — Phase 1 is GitHub/sandbox backed.
 * Phase 4 swaps in S3 + merkle without rewriting Railway Run.
 *
 * Control plane never stores user file bodies here long-term;
 * workload plane (sandbox / S3) owns the trees.
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
      // Seam only — persisted via project_change table when virtual git lands.
    },
  };
}
