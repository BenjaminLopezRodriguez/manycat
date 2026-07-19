import { z } from "zod";
import { and, eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { TRPCError } from "@trpc/server";

import { env } from "@/env";
import type { Msg, WorkflowStatus } from "@/app/_fragments/chat/data";
import { dedupeId, slugify } from "@/lib/slug";
import {
  addUsage,
  assertCanSpend,
  BudgetExceededError,
  ensureAccount,
  ESTIMATED_AGENT_TURN_CENTS,
  ESTIMATED_IMAGE_CENTS,
  ESTIMATED_SANDBOX_CENTS,
  isOverBudget,
  tokensToCents,
} from "@/server/billing/budget";
import {
  changeId,
  projectNameFromPrompt,
  scaffoldFromPrompt,
} from "@/server/content/scaffold";
import { buildTree } from "@/server/content/merkle";
import { structurePrompt } from "@/server/ai/structure-prompt";
import { runChatCompletion, type ChatMessage } from "@/server/ai/modal-chat";
import { runDeepResearch, type ResearchSource } from "@/server/ai/research";
import { runImageGeneration } from "@/server/ai/modal-image";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";

function throwBudgetExceeded(err: BudgetExceededError): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: err.message,
    cause: err,
  });
}
import { db } from "@/server/db";
import { projectChanges, projects } from "@/server/db/schema";
import {
  appendWorkflowMessages,
  clearProjectUnread,
  deletePersistedSession,
  ensurePersistenceSchema,
  ensureShellProject,
  listPersistedSessions,
  listWorkspaceFiles,
  replaceWorkspaceFiles,
  setProjectAgentRun,
  setProjectContentRoot,
  setWorkflowMessages,
} from "@/server/workflow/persist";
import { isS3Configured, putCreateImage } from "@/server/s3/create-images";
import { putBuildSnapshot } from "@/server/s3/build-store";

export type AgentEventPayload =
  | { kind: "status"; status: WorkflowStatus }
  | { kind: "append"; message: Msg }
  | { kind: "upsert-status"; message: Extract<Msg, { type: "agent-status" }> }
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

/** Local disk workspace — never under Vercel's read-only `/var/task`. */
function localWorkspaceRoot(): string | null {
  if (process.env.VERCEL) return null;
  return path.join(process.cwd(), ".sandbox-workspaces");
}

async function writeLocalWorkspace(
  workflowId: string,
  files: { path: string; contents: string }[],
): Promise<boolean> {
  const base = localWorkspaceRoot();
  if (!base) return false;
  const root = path.join(base, workflowId);
  await fs.mkdir(root, { recursive: true });
  for (const file of files) {
    const full = path.join(root, file.path);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.contents, "utf8");
  }
  return true;
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

function fetchErrorMessage(err: unknown, label: string, url?: string): string {
  const cause =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  const where = url ? ` (${url})` : "";
  if (cause === "fetch failed" || /ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(cause)) {
    return `${label} unreachable${where}. Start local infra (\`docker compose up agent orchestrator\`) or clear AGENT_HARNESS_URL / SANDBOX_ORCHESTRATOR_URL to use mock agent.`;
  }
  return `${label} failed${where}: ${cause}`;
}

/** Never dump HTML/Next 404 pages into chat. */
function summarizeUpstreamBody(status: number, body: string, label: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `${label} returned HTTP ${status} with empty body.`;
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    /<title>404: This page could not be found\.<\/title>/i.test(trimmed)
  ) {
    return (
      `${label} returned HTTP ${status} (HTML error page, not the agent API). ` +
      `AGENT_HARNESS_URL is wrong or the harness service is serving the wrong app.`
    );
  }
  if (trimmed.length > 400) {
    return `${label} returned HTTP ${status}: ${trimmed.slice(0, 400)}…`;
  }
  return `${label} returned HTTP ${status}: ${trimmed}`;
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
        if (err instanceof BudgetExceededError) throwBudgetExceeded(err);
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
        if (err instanceof BudgetExceededError) throwBudgetExceeded(err);
        throw err;
      }

      const nameSlug = projectNameFromPrompt(input.prompt);
      const scopedBase = slugify(`${ctx.accountId}-${nameSlug}`).slice(0, 64);
      const workflowId = dedupeId(scopedBase || "app", input.existingIds);
      const files = scaffoldFromPrompt(input.prompt);
      const displayName = nameSlug.replace(/-/g, " ") || "app";

      const snapshot = await putBuildSnapshot({
        accountId: ctx.accountId,
        buildId: workflowId,
        files,
        branch: "main",
        prompt: input.prompt,
        thoughts: null,
        parentCommitSha: null,
        parentTreeEntries: null,
      });
      const contentRootHash = snapshot.commitSha;

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
          // Orchestrator down — local disk only when writable (not Vercel).
          const wrote = await writeLocalWorkspace(workflowId, files);
          sandboxStatus = wrote
            ? "local-workspace-orchestrator-unreachable"
            : "virtual-no-sandbox";
          console.warn(
            "[createFromPrompt] orchestrator unreachable:",
            err instanceof Error ? err.message : err,
            wrote ? "(wrote local workspace)" : "(skipped local disk)",
          );
        }
      } else {
        const wrote = await writeLocalWorkspace(workflowId, files);
        sandboxStatus = wrote ? "local-workspace" : "virtual-no-sandbox";
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
          templateId: "next-app",
          status: "idle",
        })
        .onConflictDoUpdate({
          target: [projects.accountId, projects.id],
          set: {
            name: displayName,
            contentBackend: "virtual",
            contentRootHash,
            githubRepo: null,
            templateId: "next-app",
            status: "idle",
          },
        });

      await db.insert(projectChanges).values({
        id: snapshot.intentId || changeId(),
        accountId: ctx.accountId,
        workflowId,
        parentId: null,
        treeHash: contentRootHash,
        diff: JSON.stringify({
          treeSha: snapshot.treeSha,
          changedPaths: snapshot.changedPaths,
          thoughts: null,
          persistedToS3: snapshot.persistedToS3,
        }),
        prompt: input.prompt,
        templateId: "next-app",
      });

      const time = nowTime();
      const readyText =
        sandboxStatus === "workspace-only" || sandboxStatus.startsWith("local")
          ? `Virtual git ready (${contentRootHash.slice(0, 8)}…). Workspace written (${sandboxStatus}).`
          : `Virtual git ready (${contentRootHash.slice(0, 8)}…). Sandbox ${sandboxStatus}.`;

      const initialMessages = [
        {
          id: 1,
          type: "text" as const,
          from: "me" as const,
          text: input.prompt,
          time,
        },
        {
          id: 2,
          type: "text" as const,
          from: "agent" as const,
          text: readyText,
          time,
        },
      ];

      await setWorkflowMessages({
        accountId: ctx.accountId,
        workflowId,
        messages: initialMessages,
      });
      await replaceWorkspaceFiles({
        accountId: ctx.accountId,
        workflowId,
        files,
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
        messages: initialMessages,
      };
    }),

  /** Hydrate chats + workspace files after refresh. */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    await ensurePersistenceSchema();
    return listPersistedSessions(ctx.accountId);
  }),

  /**
   * Persist Create / research / workspace shell turns (messages + project row).
   * Dev Build projects use createFromPrompt / runAgent instead.
   */
  persistSession: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1).max(64),
        mode: z.enum(["create", "research", "workspace"]),
        name: z.string().min(1).max(256),
        status: z
          .enum(["idle", "working", "needs-review", "done"])
          .default("idle"),
        messages: z
          .array(
            z
              .object({
                id: z.number(),
                type: z.string(),
              })
              .passthrough(),
          )
          .max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      await ensureShellProject({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        mode: input.mode,
        name: input.name,
        status: input.status,
      });
      if (input.messages.length > 0) {
        await appendWorkflowMessages({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          messages: input.messages,
        });
      }
      return { ok: true as const };
    }),

  renameSession: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1).max(64),
        name: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(projects)
        .set({ name: input.name })
        .where(
          and(
            eq(projects.accountId, ctx.accountId),
            eq(projects.id, input.workflowId),
          ),
        );
      return { ok: true as const };
    }),

  deleteSession: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await deletePersistedSession({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
      });
      return { ok: true as const };
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

  runAgent: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1),
        prompt: z.string().min(1),
        messageIdStart: z.number().default(1000),
        model: z
          .enum(["auto", "qwen-coder", "gpt-4o", "claude-sonnet"])
          .default("auto"),
        effort: z.enum(["low", "medium", "high", "max"]).default("high"),
        /** Optional client workspace snapshot if orchestrator lost ephemeral disk. */
        files: z
          .array(
            z.object({
              path: z.string().min(1),
              contents: z.string(),
            }),
          )
          .max(400)
          .optional(),
        /** When true, skip appending the user message (already persisted on create). */
        omitUserMessage: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isInfraEnabled()) {
        throw new Error("Agent infrastructure is not configured");
      }

      try {
        await assertCanSpend(ctx.accountId, ESTIMATED_AGENT_TURN_CENTS);
      } catch (err) {
        if (err instanceof BudgetExceededError) throwBudgetExceeded(err);
        throw err;
      }

      let previewUrl: string | undefined;
      let orchestratorUp = false;
      try {
        const sandboxRes = await orchestratorFetch("/sandboxes", {
          method: "POST",
          body: JSON.stringify({ workflowId: input.workflowId }),
        });
        if (sandboxRes.ok) {
          orchestratorUp = true;
          const sandbox = (await sandboxRes.json()) as {
            previewUrl?: string;
          };
          previewUrl = sandbox.previewUrl;
        } else {
          console.warn(
            "[runAgent] orchestrator error:",
            await sandboxRes.text().catch(() => sandboxRes.statusText),
          );
        }
      } catch (err) {
        console.warn(
          "[runAgent] orchestrator unreachable:",
          err instanceof Error ? err.message : err,
        );
      }

      let workspaceFiles: { path: string; contents: string }[] =
        input.files ?? [];
      if (workspaceFiles.length === 0 && orchestratorUp) {
        try {
          const filesRes = await orchestratorFetch(
            `/sandboxes/${encodeURIComponent(input.workflowId)}/files`,
          );
          if (filesRes.ok) {
            const body = (await filesRes.json()) as {
              files?: { path: string; contents: string }[];
            };
            workspaceFiles = body.files ?? [];
          }
        } catch {
          /* use DB / client snapshot */
        }
      }
      if (workspaceFiles.length === 0) {
        workspaceFiles = await listWorkspaceFiles({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
        });
      }

      const events: AgentEventPayload[] = [];
      let id = input.messageIdStart;

      const userMsg = {
        id: ++id,
        type: "text" as const,
        from: "me" as const,
        text: input.prompt,
        time: nowTime(),
      };
      if (!input.omitUserMessage) {
        events.push({ kind: "append", message: userMsg });
      }
      events.push({ kind: "status", status: "working" });
      const statusMsg = {
        id: ++id,
        type: "agent-status" as const,
        text:
          workspaceFiles.length > 0
            ? `Working on workspace (${workspaceFiles.length} files)…`
            : "Working…",
        action: "building",
        path: "page.tsx",
        thinking: orchestratorUp
          ? workspaceFiles.length > 0
            ? `Synced ${workspaceFiles.length} files — agent continues if you leave this page.`
            : "Sandbox workspace is empty — agent may need to scaffold files first."
          : "Sandbox orchestrator offline — using persisted workspace files; preview URL may be unavailable.",
        streaming: true,
        time: nowTime(),
      };
      events.push({ kind: "upsert-status", message: statusMsg });

      const failStart = async (text: string) => {
        const failMsg = {
          id: ++id,
          type: "text" as const,
          from: "agent" as const,
          text,
          time: nowTime(),
        };
        events.push({ kind: "append", message: failMsg });
        events.push({ kind: "status", status: "idle" });
        events.push({ kind: "done" });
        await appendWorkflowMessages({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          messages: input.omitUserMessage
            ? [statusMsg, failMsg]
            : [userMsg, statusMsg, failMsg],
        });
        await setProjectAgentRun({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          status: "idle",
          agentJobId: null,
          lastRunOutcome: "failed",
          unread: 1,
          clearBilledTokens: true,
        });
        return {
          accepted: false as const,
          jobId: null as string | null,
          events,
          previewUrl,
          contentRootHash: undefined as string | undefined,
        };
      };

      const userFacing = input.prompt;
      const structured = await structurePrompt(userFacing);
      const harnessPrompt = structured;

      let jobRes: Response;
      try {
        jobRes = await fetch(`${env.AGENT_HARNESS_URL}/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: harnessPrompt,
            workflow_id: input.workflowId,
            mode: "default",
            model: input.model,
            effort: input.effort,
            files: workspaceFiles,
            preview_url: previewUrl,
          }),
        });
      } catch (err) {
        return failStart(
          fetchErrorMessage(err, "Agent harness", env.AGENT_HARNESS_URL),
        );
      }

      if (!jobRes.ok) {
        const err = await jobRes.text();
        return failStart(
          `Agent failed to start: ${summarizeUpstreamBody(jobRes.status, err, "Agent harness")}`,
        );
      }

      const jobBody = (await jobRes.json()) as { job_id: string };
      await setProjectAgentRun({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        status: "working",
        agentJobId: jobBody.job_id,
        lastRunOutcome: null,
        unread: 0,
        clearBilledTokens: true,
      });

      await appendWorkflowMessages({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        messages: input.omitUserMessage
          ? [statusMsg]
          : [userMsg, statusMsg],
      });

      // Reserve the turn estimate up front; reconcile bills token deltas later.
      await addUsage(ctx.accountId, ESTIMATED_AGENT_TURN_CENTS);

      return {
        accepted: true as const,
        jobId: jobBody.job_id,
        events,
        previewUrl,
        contentRootHash: undefined as string | undefined,
      };
    }),

  /**
   * Poll a background harness job: bill token deltas, cancel on budget
   * exceed (stash working-diff), or finalize when done/failed.
   */
  reconcileRun: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!isInfraEnabled()) {
        throw new Error("Agent infrastructure is not configured");
      }

      const [row] = await db
        .select({
          status: projects.status,
          agentJobId: projects.agentJobId,
          contentRootHash: projects.contentRootHash,
          agentBilledPromptTokens: projects.agentBilledPromptTokens,
          agentBilledCompletionTokens: projects.agentBilledCompletionTokens,
          name: projects.name,
        })
        .from(projects)
        .where(
          and(
            eq(projects.accountId, ctx.accountId),
            eq(projects.id, input.workflowId),
          ),
        )
        .limit(1);

      if (!row) {
        return {
          outcome: "missing" as const,
          events: [] as AgentEventPayload[],
        };
      }

      if (row.status !== "working" || !row.agentJobId) {
        const outcome = row.status === "needs-review" ? "ok" : "idle";
        return {
          outcome,
          events: [] as AgentEventPayload[],
          status: row.status,
        };
      }

      let jobRes: Response;
      try {
        jobRes = await fetch(
          `${env.AGENT_HARNESS_URL}/jobs/${encodeURIComponent(row.agentJobId)}`,
        );
      } catch (err) {
        return {
          outcome: "working" as const,
          events: [] as AgentEventPayload[],
          error: fetchErrorMessage(err, "Agent harness", env.AGENT_HARNESS_URL),
        };
      }

      if (jobRes.status === 404) {
        await setProjectAgentRun({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          status: "idle",
          agentJobId: null,
          lastRunOutcome: "failed",
          unread: 1,
          clearBilledTokens: true,
        });
        const msg = {
          id: Date.now(),
          type: "text" as const,
          from: "agent" as const,
          text: "Previous agent job was lost (harness restarted). Send a message to continue.",
          time: nowTime(),
        };
        await appendWorkflowMessages({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          messages: [msg],
        });
        return {
          outcome: "failed" as const,
          events: [
            { kind: "append" as const, message: msg },
            { kind: "status" as const, status: "idle" as const },
            { kind: "done" as const },
          ],
        };
      }

      if (!jobRes.ok) {
        return {
          outcome: "working" as const,
          events: [] as AgentEventPayload[],
          error: await jobRes.text(),
        };
      }

      const job = (await jobRes.json()) as {
        status: string;
        output?: string;
        error?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        files?: { path: string; contents: string }[];
      };

      const promptTokens = job.usage?.prompt_tokens ?? 0;
      const completionTokens = job.usage?.completion_tokens ?? 0;
      const billedPrompt = row.agentBilledPromptTokens ?? 0;
      const billedCompletion = row.agentBilledCompletionTokens ?? 0;
      const deltaPrompt = Math.max(0, promptTokens - billedPrompt);
      const deltaCompletion = Math.max(0, completionTokens - billedCompletion);
      const deltaCents = tokensToCents(deltaPrompt, deltaCompletion);
      if (deltaCents > 0) {
        await addUsage(ctx.accountId, deltaCents);
        await setProjectAgentRun({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          agentBilledPromptTokens: promptTokens,
          agentBilledCompletionTokens: completionTokens,
        });
      }

      const overBudget = await isOverBudget(ctx.accountId);
      if (overBudget && (job.status === "queued" || job.status === "running")) {
        await fetch(
          `${env.AGENT_HARNESS_URL}/jobs/${encodeURIComponent(row.agentJobId)}/cancel`,
          { method: "POST" },
        ).catch(() => null);

        // Re-fetch after cancel for latest partial files.
        let files = job.files ?? [];
        try {
          const again = await fetch(
            `${env.AGENT_HARNESS_URL}/jobs/${encodeURIComponent(row.agentJobId)}`,
          );
          if (again.ok) {
            const body = (await again.json()) as {
              files?: { path: string; contents: string }[];
              output?: string;
            };
            if (body.files?.length) files = body.files;
            if (body.output) job.output = body.output;
          }
        } catch {
          /* keep prior files */
        }

        if (files.length > 0) {
          await replaceWorkspaceFiles({
            accountId: ctx.accountId,
            workflowId: input.workflowId,
            files,
          });
          await orchestratorFetch(
            `/sandboxes/${encodeURIComponent(input.workflowId)}/files`,
            {
              method: "PUT",
              body: JSON.stringify({ files }),
            },
          ).catch(() => null);
        }

        const beforeTree = buildTree(
          await listWorkspaceFiles({
            accountId: ctx.accountId,
            workflowId: input.workflowId,
          }),
        ).tree;
        const snapshot = await putBuildSnapshot({
          accountId: ctx.accountId,
          buildId: input.workflowId,
          files:
            files.length > 0
              ? files
              : await listWorkspaceFiles({
                  accountId: ctx.accountId,
                  workflowId: input.workflowId,
                }),
          branch: "main",
          prompt: "budget-stop",
          thoughts: "Stopped — compute budget exceeded.",
          parentCommitSha: row.contentRootHash ?? null,
          parentTreeEntries: beforeTree.entries,
        });
        await setProjectContentRoot({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          contentRootHash: snapshot.commitSha,
        });
        await db.insert(projectChanges).values({
          id: snapshot.intentId || changeId(),
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          parentId: snapshot.parentCommitSha,
          treeHash: snapshot.commitSha,
          diff: JSON.stringify({
            kind: "working-diff",
            reason: "budget",
            treeSha: snapshot.treeSha,
            changedPaths: snapshot.changedPaths,
          }),
          prompt: "budget-stop",
          templateId: null,
        });

        const agentText = {
          id: Date.now(),
          type: "text" as const,
          from: "agent" as const,
          text:
            "Stopped — compute budget exceeded. Partial changes were saved as a working diff. Upgrade to continue.",
          time: nowTime(),
        };
        await appendWorkflowMessages({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          messages: [agentText],
        });
        await setProjectAgentRun({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          status: "idle",
          agentJobId: null,
          lastRunOutcome: "budget",
          unread: 1,
          clearBilledTokens: true,
        });

        const events: AgentEventPayload[] = [];
        for (const file of files) {
          events.push({
            kind: "patch-workspace",
            path: file.path,
            contents: file.contents,
            edited: true,
          });
        }
        events.push({ kind: "append", message: agentText });
        events.push({ kind: "status", status: "idle" });
        events.push({ kind: "done" });

        return {
          outcome: "budget" as const,
          events,
          contentRootHash: snapshot.commitSha,
        };
      }

      if (job.status === "queued" || job.status === "running") {
        const events: AgentEventPayload[] = [];
        if (job.files?.length) {
          for (const file of job.files) {
            events.push({
              kind: "patch-workspace",
              path: file.path,
              contents: file.contents,
              edited: true,
            });
          }
        }
        return { outcome: "working" as const, events };
      }

      const files = job.files ?? [];
      const events: AgentEventPayload[] = [];
      let id = Date.now();

      if (files.length > 0) {
        await replaceWorkspaceFiles({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          files,
        });
        await orchestratorFetch(
          `/sandboxes/${encodeURIComponent(input.workflowId)}/files`,
          {
            method: "PUT",
            body: JSON.stringify({ files }),
          },
        ).catch(() => null);
        for (const file of files) {
          events.push({
            kind: "patch-workspace",
            path: file.path,
            contents: file.contents,
            edited: true,
          });
        }
      }

      const nextFiles =
        files.length > 0
          ? files
          : await listWorkspaceFiles({
              accountId: ctx.accountId,
              workflowId: input.workflowId,
            });
      const beforeTree = buildTree(nextFiles).tree;
      const thoughtMatch =
        /(?:^|\n)Thinking:\s*([\s\S]{0,2000}?)(?:\n\n|$)/i.exec(
          job.output ?? "",
        );
      const thoughts = thoughtMatch?.[1]?.trim() ?? null;

      const snapshot = await putBuildSnapshot({
        accountId: ctx.accountId,
        buildId: input.workflowId,
        files: nextFiles,
        branch: "main",
        prompt: row.name,
        thoughts,
        parentCommitSha: row.contentRootHash ?? null,
        parentTreeEntries: beforeTree.entries,
      });
      await setProjectContentRoot({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        contentRootHash: snapshot.commitSha,
      });

      const isFail =
        job.status === "failed" ||
        job.status === "cancelled";
      await db.insert(projectChanges).values({
        id: snapshot.intentId || changeId(),
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        parentId: snapshot.parentCommitSha,
        treeHash: snapshot.commitSha,
        diff: JSON.stringify({
          kind: isFail && job.status === "cancelled" ? "working-diff" : "agent-run",
          reason: job.status,
          treeSha: snapshot.treeSha,
          changedPaths: snapshot.changedPaths,
          thoughts,
          persistedToS3: snapshot.persistedToS3,
        }),
        prompt: row.name,
        templateId: null,
      });

      if (isFail) {
        const agentText = {
          id: ++id,
          type: "text" as const,
          from: "agent" as const,
          text:
            job.status === "cancelled"
              ? (job.output ?? "Run cancelled. Partial changes were saved.")
              : `Agent failed: ${job.error ?? job.output ?? "unknown error"}`,
          time: nowTime(),
        };
        events.push({ kind: "append", message: agentText });
        events.push({ kind: "status", status: "idle" });
        events.push({ kind: "done" });
        await appendWorkflowMessages({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          messages: [agentText],
        });
        await setProjectAgentRun({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          status: "idle",
          agentJobId: null,
          lastRunOutcome: "failed",
          unread: 1,
          clearBilledTokens: true,
        });
        return {
          outcome: "failed" as const,
          events,
          contentRootHash: snapshot.commitSha,
        };
      }

      const agentText = {
        id: ++id,
        type: "text" as const,
        from: "agent" as const,
        text: job.output ?? "Updated workspace files.",
        time: nowTime(),
      };
      const approvalMsg = {
        id: ++id,
        type: "approval" as const,
        text: "Review agent changes in the workspace — approve when ready.",
        resolved: null as boolean | null,
        time: nowTime(),
      };
      events.push({ kind: "append", message: agentText });
      events.push({ kind: "append", message: approvalMsg });
      events.push({ kind: "status", status: "needs-review" });
      events.push({ kind: "done" });

      await appendWorkflowMessages({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        messages: [agentText, approvalMsg],
      });
      await setProjectAgentRun({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        status: "needs-review",
        agentJobId: null,
        lastRunOutcome: "ok",
        unread: 1,
        clearBilledTokens: true,
      });

      return {
        outcome: "ok" as const,
        events,
        contentRootHash: snapshot.commitSha,
      };
    }),

  clearUnread: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await clearProjectUnread({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
      });
      return { ok: true as const };
    }),

  cancelAgentJob: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select({ agentJobId: projects.agentJobId })
        .from(projects)
        .where(
          and(
            eq(projects.accountId, ctx.accountId),
            eq(projects.id, input.workflowId),
          ),
        )
        .limit(1);
      if (row?.agentJobId && env.AGENT_HARNESS_URL) {
        await fetch(
          `${env.AGENT_HARNESS_URL}/jobs/${encodeURIComponent(row.agentJobId)}/cancel`,
          { method: "POST" },
        ).catch(() => null);
      }
      return { ok: true as const };
    }),

  /**
   * Chat harness — shared Modal chat model for "research" (Chat) and
   * "workspace" (Work) shell modes. No filesystem/coding tools, no sandbox.
   * ponytail: workspace's Zapier-style tool calling isn't wired yet — same
   * model, different system prompt, until tools are actually built.
   */
  runChat: protectedProcedure
    .input(
      z.object({
        mode: z.enum(["research", "workspace"]),
        prompt: z.string().min(1),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            }),
          )
          .max(20)
          .default([]),
        effort: z.enum(["low", "medium", "high", "max"]).default("high"),
        /** Research mode only — searches + reads arXiv before replying. */
        deepResearch: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.mode === "research" && input.deepResearch) {
        return runDeepResearch({
          prompt: input.prompt,
          history: input.history,
          effort: input.effort,
        });
      }

      const systemPrompt =
        input.mode === "workspace"
          ? "You are Manycat's workplace assistant. Help the user plan and " +
            "track their work. You do not have any connected tools yet " +
            "(Zapier-style integrations are coming) — say so if asked to " +
            "take an action outside the conversation."
          : "You are Manycat's chat assistant. Answer helpfully and concisely.";

      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...input.history,
        { role: "user", content: input.prompt },
      ];

      const reply = await runChatCompletion(messages);
      return { reply, sources: [] as ResearchSource[] };
    }),

  /** Image harness — Modal-hosted FLUX.1-schnell for "create" shell mode. */
  runImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        /** When set with imageId, upload PNG to private S3 and return a signed URL. */
        chatId: z.string().min(1).max(64).optional(),
        imageId: z.string().min(1).max(128).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      try {
        await assertCanSpend(ctx.accountId, ESTIMATED_IMAGE_CENTS);
      } catch (err) {
        if (err instanceof BudgetExceededError) throwBudgetExceeded(err);
        throw err;
      }

      const dataUrl = await runImageGeneration(input.prompt);
      await addUsage(ctx.accountId, ESTIMATED_IMAGE_CENTS);

      if (input.chatId && input.imageId) {
        if (!isS3Configured()) {
          throw new Error(
            "S3 is not configured — set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY to persist Create images",
          );
        }
        const { key, url } = await putCreateImage({
          accountId: ctx.accountId,
          chatId: input.chatId,
          imageId: input.imageId,
          dataUrl,
        });
        return { image: url, s3Key: key };
      }

      return { image: dataUrl };
    }),
});
