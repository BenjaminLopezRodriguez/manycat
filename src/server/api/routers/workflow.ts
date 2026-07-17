import { z } from "zod";
import { and, eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "@/env";
import type { Msg, WorkflowStatus } from "@/app/_fragments/chat/data";
import { dedupeId, slugify } from "@/lib/slug";
import {
  addUsage,
  assertCanSpend,
  BudgetExceededError,
  ensureAccount,
  ESTIMATED_SANDBOX_CENTS,
} from "@/server/billing/budget";
import {
  changeId,
  hashTree,
  projectNameFromPrompt,
  scaffoldFromPrompt,
} from "@/server/content/scaffold";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import { projectChanges, projects } from "@/server/db/schema";

export type AgentEventPayload =
  | { kind: "status"; status: WorkflowStatus }
  | { kind: "append"; message: Msg }
  | {
      kind: "patch-workspace";
      path: string;
      contents: string;
      edited?: boolean;
    }
  | { kind: "resolve-approval"; messageId: number; resolved: boolean }
  | { kind: "done" };

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isInfraEnabled() {
  return Boolean(env.AGENT_HARNESS_URL && env.SANDBOX_ORCHESTRATOR_URL);
}

const GITHUB_REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
const SHORTHAND_RE = /^[\w.-]+\/[\w.-]+$/;

function normalizeRepoUrl(raw: string): string {
  const url = SHORTHAND_RE.test(raw) ? `https://github.com/${raw}` : raw;
  if (!GITHUB_REPO_RE.test(url)) {
    throw new Error("repoUrl must be a github.com https URL or owner/repo");
  }
  return url;
}

function repoNameFromUrl(url: string): { owner: string; repo: string } {
  const match = /github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?$/.exec(url);
  if (!match?.[1] || !match[2]) throw new Error("Could not parse repoUrl");
  return { owner: match[1], repo: match[2] };
}

async function orchestratorFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = env.SANDBOX_ORCHESTRATOR_URL!;
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

export const workflowRouter = createTRPCRouter({
  isEnabled: publicProcedure.query(() => ({ enabled: isInfraEnabled() })),

  createSandbox: publicProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!isInfraEnabled()) {
        throw new Error("Sandbox orchestrator is not configured");
      }
      const res = await orchestratorFetch("/sandboxes", {
        method: "POST",
        body: JSON.stringify({ workflowId: input.workflowId }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Orchestrator error: ${err}`);
      }
      return res.json() as Promise<{
        workflowId: string;
        status: string;
        hostPort: number;
        previewUrl: string;
      }>;
    }),

  getSandbox: publicProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!isInfraEnabled()) return null;
      const res = await orchestratorFetch(
        `/sandboxes/${encodeURIComponent(input.workflowId)}`,
      );
      if (!res.ok) return null;
      return res.json() as Promise<{
        workflowId: string;
        status: string;
        previewUrl: string;
      }>;
    }),

  deleteSandbox: publicProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!isInfraEnabled()) return { status: "skipped" };
      const res = await orchestratorFetch(
        `/sandboxes/${encodeURIComponent(input.workflowId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json() as Promise<{ workflowId: string; status: string }>;
    }),

  importRepo: protectedProcedure
    .input(
      z.object({
        repoUrl: z.string().min(1),
        existingIds: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isInfraEnabled()) {
        throw new Error("Sandbox orchestrator is not configured");
      }

      await ensureAccount(ctx.accountId);
      try {
        await assertCanSpend(ctx.accountId, ESTIMATED_SANDBOX_CENTS);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        throw err;
      }

      const repoUrl = normalizeRepoUrl(input.repoUrl);
      const { owner, repo } = repoNameFromUrl(repoUrl);
      // Scope workflow id with account prefix to avoid cross-account collisions.
      const baseId = slugify(`${owner}-${repo}`);
      const scopedBase = slugify(`${ctx.accountId}-${baseId}`).slice(0, 64);
      const workflowId = dedupeId(scopedBase, input.existingIds);

      const res = await orchestratorFetch("/sandboxes", {
        method: "POST",
        body: JSON.stringify({
          workflowId,
          repoUrl,
          accountId: ctx.accountId,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          stage?: string;
        } | null;
        const message = body?.error ?? (await res.text().catch(() => "Import failed"));
        throw new Error(
          body?.stage === "clone"
            ? `Couldn't clone ${owner}/${repo}: ${message}`
            : message,
        );
      }

      await addUsage(ctx.accountId, ESTIMATED_SANDBOX_CENTS);

      const existing = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.accountId, ctx.accountId),
            eq(projects.id, workflowId),
          ),
        )
        .limit(1);

      if (existing[0]) {
        await db
          .update(projects)
          .set({
            name: repo,
            githubRepo: `${owner}/${repo}`,
            contentBackend: "github",
          })
          .where(
            and(
              eq(projects.accountId, ctx.accountId),
              eq(projects.id, workflowId),
            ),
          );
      } else {
        await db.insert(projects).values({
          id: workflowId,
          accountId: ctx.accountId,
          name: repo,
          githubRepo: `${owner}/${repo}`,
          contentBackend: "github",
          contentRootHash: null,
          templateId: null,
        });
      }

      return {
        workflowId,
        name: repo,
        repo: `${owner}/${repo}`,
        status: "idle" as const,
      };
    }),

  /**
   * Prompt-box create: virtual git tree + sandbox VM (no GitHub required).
   */
  createFromPrompt: protectedProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(2).max(500),
        existingIds: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      try {
        await assertCanSpend(ctx.accountId, ESTIMATED_SANDBOX_CENTS);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        throw err;
      }

      const nameSlug = projectNameFromPrompt(input.prompt);
      const scopedBase = slugify(`${ctx.accountId}-${nameSlug}`).slice(0, 64);
      const workflowId = dedupeId(scopedBase || "app", input.existingIds);
      const files = scaffoldFromPrompt(input.prompt);
      const contentRootHash = hashTree(files);
      const displayName = nameSlug.replace(/-/g, " ") || "app";

      let previewUrl: string | undefined;
      let sandboxStatus = "pending";

      if (isInfraEnabled()) {
        try {
          const res = await orchestratorFetch("/sandboxes", {
            method: "POST",
            body: JSON.stringify({
              workflowId,
              accountId: ctx.accountId,
              prompt: input.prompt,
              files,
            }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              error?: string;
              stage?: string;
            } | null;
            throw new Error(
              body?.error ??
                (await res.text().catch(() => "Failed to spawn sandbox")),
            );
          }
          const body = (await res.json()) as {
            previewUrl?: string;
            status?: string;
          };
          previewUrl = body.previewUrl;
          sandboxStatus = body.status ?? "running";
        } catch (err) {
          // Orchestrator down / unreachable — still create virtual git on disk.
          const root = path.join(
            process.cwd(),
            ".sandbox-workspaces",
            workflowId,
          );
          await fs.mkdir(root, { recursive: true });
          for (const file of files) {
            const full = path.join(root, file.path);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, file.contents, "utf8");
          }
          sandboxStatus = "local-workspace-orchestrator-unreachable";
          console.warn(
            "[createFromPrompt] orchestrator unreachable, wrote local workspace:",
            err instanceof Error ? err.message : err,
          );
        }
      } else {
        // Local fallback without orchestrator: write virtual workspace on host.
        const root = path.join(process.cwd(), ".sandbox-workspaces", workflowId);
        await fs.mkdir(root, { recursive: true });
        for (const file of files) {
          const full = path.join(root, file.path);
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, file.contents, "utf8");
        }
        sandboxStatus = "local-workspace";
      }

      await addUsage(ctx.accountId, ESTIMATED_SANDBOX_CENTS);

      await db
        .insert(projects)
        .values({
          id: workflowId,
          accountId: ctx.accountId,
          name: displayName,
          githubRepo: null,
          contentBackend: "virtual",
          contentRootHash,
          templateId: null,
        })
        .onConflictDoUpdate({
          target: [projects.accountId, projects.id],
          set: {
            name: displayName,
            contentBackend: "virtual",
            contentRootHash,
            githubRepo: null,
          },
        });

      await db.insert(projectChanges).values({
        id: changeId(),
        accountId: ctx.accountId,
        workflowId,
        parentId: null,
        treeHash: contentRootHash,
        diff: null,
        prompt: input.prompt,
        templateId: null,
      });

      return {
        workflowId,
        name: displayName,
        prompt: input.prompt,
        contentRootHash,
        previewUrl,
        status: "idle" as const,
        sandboxStatus,
        files: files.map((f) => ({
          path: f.path,
          contents: f.contents,
        })),
      };
    }),

  getSandboxFiles: publicProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!isInfraEnabled()) return { files: [] };
      const res = await orchestratorFetch(
        `/sandboxes/${encodeURIComponent(input.workflowId)}/files`,
      );
      if (!res.ok) return { files: [] };
      return res.json() as Promise<{
        workflowId: string;
        files: { path: string; contents: string }[];
      }>;
    }),

  runAgent: publicProcedure
    .input(
      z.object({
        workflowId: z.string().min(1),
        prompt: z.string().min(1),
        messageIdStart: z.number().default(1000),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isInfraEnabled()) {
        throw new Error("Agent infrastructure is not configured");
      }

      const sandboxRes = await orchestratorFetch("/sandboxes", {
        method: "POST",
        body: JSON.stringify({ workflowId: input.workflowId }),
      });
      if (!sandboxRes.ok) {
        throw new Error(await sandboxRes.text());
      }
      const sandbox = (await sandboxRes.json()) as {
        previewUrl: string;
      };

      const events: AgentEventPayload[] = [];
      let id = input.messageIdStart;

      events.push({
        kind: "append",
        message: {
          id: ++id,
          type: "text",
          from: "me",
          text: input.prompt,
          time: nowTime(),
        },
      });
      events.push({ kind: "status", status: "working" });
      events.push({
        kind: "append",
        message: {
          id: ++id,
          type: "agent-status",
          text: "Agent is working in sandbox…",
          streaming: true,
          time: nowTime(),
        },
      });

      const agentRes = await fetch(`${env.AGENT_HARNESS_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          workflow_id: input.workflowId,
          mode: "default",
        }),
      });

      if (!agentRes.ok) {
        const err = await agentRes.text();
        events.push({
          kind: "append",
          message: {
            id: ++id,
            type: "text",
            from: "agent",
            text: `Agent failed: ${err}`,
            time: nowTime(),
          },
        });
        events.push({ kind: "status", status: "idle" });
        events.push({ kind: "done" });
        return { events, previewUrl: sandbox.previewUrl };
      }

      const agentBody = (await agentRes.json()) as { output: string };
      events.push({
        kind: "append",
        message: {
          id: ++id,
          type: "text",
          from: "agent",
          text: agentBody.output,
          time: nowTime(),
        },
      });
      events.push({
        kind: "append",
        message: {
          id: ++id,
          type: "approval",
          text: "Review agent changes in the workspace — approve when ready.",
          resolved: null,
          time: nowTime(),
        },
      });
      events.push({ kind: "status", status: "needs-review" });
      events.push({ kind: "done" });

      return { events, previewUrl: sandbox.previewUrl };
    }),
});
