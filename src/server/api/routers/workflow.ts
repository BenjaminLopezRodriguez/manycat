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
import { structurePrompt } from "@/server/ai/structure-prompt";
import { runChatCompletion, type ChatMessage } from "@/server/ai/modal-chat";
import { runImageGeneration } from "@/server/ai/modal-image";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import { projectChanges, projects } from "@/server/db/schema";
import {
  appendWorkflowMessages,
  listPersistedSessions,
  replaceWorkspaceFiles,
  setProjectStatus,
  setWorkflowMessages,
} from "@/server/workflow/persist";

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
        id: changeId(),
        accountId: ctx.accountId,
        workflowId,
        parentId: null,
        treeHash: contentRootHash,
        diff: null,
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
    return listPersistedSessions(ctx.accountId);
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

      await setProjectStatus({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        status: "working",
      });

      const sandboxRes = await orchestratorFetch("/sandboxes", {
        method: "POST",
        body: JSON.stringify({ workflowId: input.workflowId }),
      });
      if (!sandboxRes.ok) {
        throw new Error(await sandboxRes.text());
      }
      const sandbox = (await sandboxRes.json()) as {
        previewUrl?: string;
      };

      let workspaceFiles: { path: string; contents: string }[] =
        input.files ?? [];
      if (workspaceFiles.length === 0) {
        const filesRes = await orchestratorFetch(
          `/sandboxes/${encodeURIComponent(input.workflowId)}/files`,
        );
        if (filesRes.ok) {
          const body = (await filesRes.json()) as {
            files?: { path: string; contents: string }[];
          };
          workspaceFiles = body.files ?? [];
        }
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
            ? `Working in sandbox (${workspaceFiles.length} files)…`
            : "Working in sandbox…",
        action: "building",
        path: "page.tsx",
        thinking:
          workspaceFiles.length > 0
            ? `Synced ${workspaceFiles.length} files into the sandbox and starting the agent loop.`
            : "Sandbox workspace is empty — agent may need to scaffold files first.",
        streaming: true,
        time: nowTime(),
      };
      events.push({ kind: "upsert-status", message: statusMsg });

      // Expand the raw ask into a structured spec before handing it to the
      // codegen model (Modal-hosted coder) — the user still only ever sees
      // their original message in the chat transcript.
      const structuredPrompt = await structurePrompt(input.prompt);

      const agentRes = await fetch(`${env.AGENT_HARNESS_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: structuredPrompt,
          workflow_id: input.workflowId,
          mode: "default",
          model: input.model,
          effort: input.effort,
          files: workspaceFiles,
        }),
      });

      if (!agentRes.ok) {
        const err = await agentRes.text();
        const failMsg = {
          id: ++id,
          type: "text" as const,
          from: "agent" as const,
          text: `Agent failed: ${err}`,
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
        await setProjectStatus({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          status: "idle",
        });
        return { events, previewUrl: sandbox.previewUrl };
      }

      const agentBody = (await agentRes.json()) as {
        output: string;
        files?: { path: string; contents: string }[];
      };

      if (agentBody.files && agentBody.files.length > 0) {
        await orchestratorFetch(
          `/sandboxes/${encodeURIComponent(input.workflowId)}/files`,
          {
            method: "PUT",
            body: JSON.stringify({ files: agentBody.files }),
          },
        ).catch(() => null);

        await replaceWorkspaceFiles({
          accountId: ctx.accountId,
          workflowId: input.workflowId,
          files: agentBody.files,
        });

        for (const file of agentBody.files) {
          events.push({
            kind: "patch-workspace",
            path: file.path,
            contents: file.contents,
            edited: true,
          });
        }
      }

      const agentText = {
        id: ++id,
        type: "text" as const,
        from: "agent" as const,
        text: agentBody.output,
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
        messages: input.omitUserMessage
          ? [statusMsg, agentText, approvalMsg]
          : [userMsg, statusMsg, agentText, approvalMsg],
      });
      await setProjectStatus({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        status: "needs-review",
      });

      return { events, previewUrl: sandbox.previewUrl };
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
      }),
    )
    .mutation(async ({ input }) => {
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
      return { reply };
    }),

  /** Image harness — Modal-hosted FLUX.1-schnell for "create" shell mode. */
  runImage: protectedProcedure
    .input(z.object({ prompt: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const image = await runImageGeneration(input.prompt);
      return { image };
    }),
});
