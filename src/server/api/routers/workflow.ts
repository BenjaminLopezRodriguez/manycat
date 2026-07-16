import { z } from "zod";

import { env } from "@/env";
import type { Msg, WorkflowStatus } from "@/app/_fragments/chat/data";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

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
