import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import {
  addUsage,
  assertCanSpend,
  budgetSummary,
  BudgetExceededError,
  ensureAccount,
  ESTIMATED_DEPLOY_CENTS,
} from "@/server/billing/budget";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import {
  deployProjectToRailway,
  getWorkloadRailwayConfig,
} from "@/server/railway/client";

const execFileAsync = promisify(execFile);

// ponytail: assumes the Next.js server runs directly on the host (pnpm dev), so
// process.cwd() shares a filesystem with .sandbox-workspaces. If the app ever runs
// inside its own container without that bind mount, vercel deploys will fail with a
// clear ENOENT rather than silently doing the wrong thing.
const WORKSPACE_ROOT = path.join(process.cwd(), ".sandbox-workspaces");

function isInfraEnabled() {
  return Boolean(env.AGENT_HARNESS_URL && env.SANDBOX_ORCHESTRATOR_URL);
}

async function orchestratorFetch(p: string, init?: RequestInit): Promise<Response> {
  const base = env.SANDBOX_ORCHESTRATOR_URL!;
  return fetch(`${base}${p}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function scrub(text: string, secret: string | undefined) {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

const DEPLOY_URL_RE = /https:\/\/[a-zA-Z0-9.-]+\.vercel\.app[^\s"'<>]*/g;

function extractDeployUrl(log: string): string | undefined {
  const aliased = /Aliased\s+(https:\/\/\S+)/.exec(log)?.[1];
  if (aliased) return aliased;
  return [...log.matchAll(DEPLOY_URL_RE)].at(-1)?.[0];
}

const workflowIdInput = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "invalid workflowId");

const vercelProjectNameInput = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "invalid Vercel project name")
  .optional();

const runConfigInput = z.object({
  kind: z.enum(["vercel", "railway", "custom", "none"]),
  vercel: z.object({ projectName: vercelProjectNameInput }).optional(),
  railway: z
    .object({
      /** owner/repo — defaults to project.githubRepo when omitted */
      githubRepo: z
        .string()
        .regex(/^[\w.-]+\/[\w.-]+$/, "invalid githubRepo")
        .optional(),
    })
    .optional(),
  custom: z.object({ command: z.string() }).optional(),
});

type RunResult = {
  status: "success" | "failed";
  url?: string;
  log?: string;
  startedAt: string;
  finishedAt: string;
};

async function getOwnedProject(accountId: string, workflowId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.accountId, accountId), eq(projects.id, workflowId)))
    .limit(1);
  return rows[0] ?? null;
}

export const projectRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.accountId, ctx.accountId));
    return rows;
  }),

  budget: protectedProcedure.query(async ({ ctx }) => {
    const account = await ensureAccount(ctx.accountId);
    return budgetSummary(account);
  }),

  upsertFromImport: protectedProcedure
    .input(
      z.object({
        workflowId: workflowIdInput,
        name: z.string().min(1).max(256),
        githubRepo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      const existing = await getOwnedProject(ctx.accountId, input.workflowId);
      if (existing) {
        await db
          .update(projects)
          .set({
            name: input.name,
            githubRepo: input.githubRepo,
            contentBackend: "github",
          })
          .where(
            and(
              eq(projects.accountId, ctx.accountId),
              eq(projects.id, input.workflowId),
            ),
          );
        return { ...existing, name: input.name, githubRepo: input.githubRepo };
      }

      const [row] = await db
        .insert(projects)
        .values({
          id: input.workflowId,
          accountId: ctx.accountId,
          name: input.name,
          githubRepo: input.githubRepo,
          contentBackend: "github",
          contentRootHash: null,
          templateId: null,
        })
        .returning();
      return row;
    }),

  run: protectedProcedure
    .input(
      z.object({
        workflowId: workflowIdInput,
        runConfig: runConfigInput,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<RunResult> => {
      const startedAt = new Date().toISOString();

      if (input.runConfig.kind === "none") {
        throw new Error("This project has no run action configured.");
      }

      if (input.runConfig.kind === "railway") {
        const config = getWorkloadRailwayConfig();
        if (!config) {
          return {
            status: "failed",
            log: "Railway not configured — set RAILWAY_API_TOKEN, RAILWAY_WORKLOAD_PROJECT_ID, and RAILWAY_WORKLOAD_ENVIRONMENT_ID.",
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }

        try {
          await assertCanSpend(ctx.accountId, ESTIMATED_DEPLOY_CENTS);
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            return {
              status: "failed",
              log: err.message,
              startedAt,
              finishedAt: new Date().toISOString(),
            };
          }
          throw err;
        }

        const project = await getOwnedProject(ctx.accountId, input.workflowId);
        const githubRepo =
          input.runConfig.railway?.githubRepo ?? project?.githubRepo ?? null;
        if (!githubRepo) {
          return {
            status: "failed",
            log: "No GitHub repo linked to this project for Railway deploy.",
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }

        try {
          const result = await deployProjectToRailway({
            config,
            accountId: ctx.accountId,
            workflowId: input.workflowId,
            githubRepo,
            existingServiceId: project?.railwayServiceId,
          });

          await addUsage(ctx.accountId, ESTIMATED_DEPLOY_CENTS);

          if (project) {
            await db
              .update(projects)
              .set({
                railwayServiceId: result.serviceId,
                railwayDomain: result.url ?? project.railwayDomain,
              })
              .where(
                and(
                  eq(projects.accountId, ctx.accountId),
                  eq(projects.id, input.workflowId),
                ),
              );
          } else {
            await db.insert(projects).values({
              id: input.workflowId,
              accountId: ctx.accountId,
              name: githubRepo.split("/")[1] ?? input.workflowId,
              githubRepo,
              contentBackend: "github",
              railwayServiceId: result.serviceId,
              railwayDomain: result.url ?? null,
            });
          }

          return {
            status: "success",
            url: result.url,
            log: `Deployed to Railway workload plane (deployment ${result.deploymentId}). Service ${result.serviceId}.`,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        } catch (err) {
          return {
            status: "failed",
            log: err instanceof Error ? err.message : String(err),
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }
      }

      if (input.runConfig.kind === "vercel") {
        if (!env.VERCEL_TOKEN) {
          return {
            status: "failed",
            log: "Vercel not configured — set VERCEL_TOKEN to enable deploys.",
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }

        try {
          await assertCanSpend(ctx.accountId, ESTIMATED_DEPLOY_CENTS);
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            return {
              status: "failed",
              log: err.message,
              startedAt,
              finishedAt: new Date().toISOString(),
            };
          }
          throw err;
        }

        const cwd = path.join(WORKSPACE_ROOT, input.workflowId);
        const [realCwd, realRoot] = await Promise.all([
          fs.promises.realpath(cwd).catch(() => null),
          fs.promises.realpath(WORKSPACE_ROOT),
        ]);
        if (!realCwd?.startsWith(realRoot + path.sep)) {
          throw new Error("Workspace not found for this project.");
        }

        const args = ["vercel@latest", "deploy", "--yes"];
        if (input.runConfig.vercel?.projectName) {
          args.push("--name", input.runConfig.vercel.projectName);
        }

        try {
          const { stdout, stderr } = await execFileAsync("npx", args, {
            cwd,
            timeout: 300_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, VERCEL_TOKEN: env.VERCEL_TOKEN },
          });
          const log = scrub(`${stdout}\n${stderr}`, env.VERCEL_TOKEN);
          await addUsage(ctx.accountId, ESTIMATED_DEPLOY_CENTS);
          return {
            status: "success",
            url: extractDeployUrl(log),
            log,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        } catch (err) {
          const raw =
            err && typeof err === "object" && "stdout" in err
              ? `${String((err as { stdout?: string }).stdout ?? "")}\n${String((err as { stderr?: string }).stderr ?? "")}`
              : err instanceof Error
                ? err.message
                : String(err);
          return {
            status: "failed",
            log: scrub(raw, env.VERCEL_TOKEN),
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }
      }

      // kind === "custom" — must execute inside the sandbox container, never the host
      if (!isInfraEnabled()) {
        throw new Error("Sandbox orchestrator is not configured");
      }
      const command =
        input.runConfig.custom?.command.trim().split(/\s+/).filter(Boolean) ??
        [];
      if (command.length === 0) {
        throw new Error("No command configured for this project.");
      }

      try {
        await assertCanSpend(ctx.accountId, ESTIMATED_DEPLOY_CENTS);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          return {
            status: "failed",
            log: err.message,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }
        throw err;
      }

      try {
        const res = await orchestratorFetch(
          `/sandboxes/${encodeURIComponent(input.workflowId)}/exec`,
          {
            method: "POST",
            body: JSON.stringify({
              command,
              timeoutMs: 60_000,
              accountId: ctx.accountId,
            }),
          },
        );
        const body = (await res.json()) as {
          exitCode?: number;
          output?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Command failed");
        await addUsage(ctx.accountId, ESTIMATED_DEPLOY_CENTS);
        return {
          status: body.exitCode === 0 ? "success" : "failed",
          log: body.output ?? "",
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          status: "failed",
          log: err instanceof Error ? err.message : String(err),
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }
    }),
});
