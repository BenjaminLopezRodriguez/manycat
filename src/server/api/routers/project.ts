import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { env } from "@/env";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

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

/** Vercel CLI prints several URLs (inspect, per-deployment, aliased). The
 * per-deployment one can sit behind Vercel's login/SSO deployment protection
 * and won't actually open publicly — the "▲ Aliased" line is the reliably
 * public one when present, so prefer it before falling back to the last
 * vercel.app URL seen in the log. */
function extractDeployUrl(log: string): string | undefined {
  const aliased = /Aliased\s+(https:\/\/\S+)/.exec(log)?.[1];
  if (aliased) return aliased;
  return [...log.matchAll(DEPLOY_URL_RE)].at(-1)?.[0];
}

// Matches the slug shape actually produced by slugify() (@/lib/slug) — also closes
// off path traversal (cwd = WORKSPACE_ROOT/workflowId) and argv-adjacent characters.
const workflowIdInput = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "invalid workflowId");

// Vercel project names: lowercase alphanumeric + dashes. Rejecting anything else
// (in particular a leading "-") also blocks argv flag-smuggling via --name.
const vercelProjectNameInput = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "invalid Vercel project name")
  .optional();

const runConfigInput = z.object({
  kind: z.enum(["vercel", "custom", "none"]),
  vercel: z.object({ projectName: vercelProjectNameInput }).optional(),
  custom: z.object({ command: z.string() }).optional(),
});

type RunResult = {
  status: "success" | "failed";
  url?: string;
  log?: string;
  startedAt: string;
  finishedAt: string;
};

export const projectRouter = createTRPCRouter({
  run: publicProcedure
    .input(
      z.object({
        workflowId: workflowIdInput,
        runConfig: runConfigInput,
      }),
    )
    .mutation(async ({ input }): Promise<RunResult> => {
      const startedAt = new Date().toISOString();

      if (input.runConfig.kind === "none") {
        throw new Error("This project has no run action configured.");
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

        const cwd = path.join(WORKSPACE_ROOT, input.workflowId);
        // Defense in depth beyond the workflowId regex — guards against symlink tricks.
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
            // token via env, not argv — argv is visible to other local users via `ps`
            env: { ...process.env, VERCEL_TOKEN: env.VERCEL_TOKEN },
          });
          const log = scrub(`${stdout}\n${stderr}`, env.VERCEL_TOKEN);
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
      // ponytail: naive whitespace split, no quoted-arg parsing. Fine for v1's
      // single-word/simple-flag commands (e.g. "ls -la"); upgrade if quoting is needed.
      const command = input.runConfig.custom?.command.trim().split(/\s+/).filter(Boolean) ?? [];
      if (command.length === 0) {
        throw new Error("No command configured for this project.");
      }

      try {
        const res = await orchestratorFetch(
          `/sandboxes/${encodeURIComponent(input.workflowId)}/exec`,
          { method: "POST", body: JSON.stringify({ command, timeoutMs: 60_000 }) },
        );
        const body = (await res.json()) as {
          exitCode?: number;
          output?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Command failed");
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
