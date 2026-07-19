"use client";

import * as React from "react";

import { api } from "@/trpc/react";
import type { AgentEventPayload } from "@/server/api/routers/workflow";
import type { EffortId, ModelId } from "@/lib/ai-models";
import {
  agentScripts,
  type Msg,
  type Workflow,
  type WorkspaceFile,
} from "./data";

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nextId(messages: Msg[]) {
  return messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;
}

export type AgentEvent = AgentEventPayload;

type UseAgentOptions = {
  workflow: Workflow;
  onEvent: (event: AgentEvent) => void;
  onPreviewUrl?: (url: string) => void;
  onContentRootHash?: (hash: string) => void;
  /** Fired when a background harness job is accepted. */
  onJobStarted?: (jobId: string) => void;
  model?: ModelId;
  effort?: EffortId;
};

export type AgentControls = {
  run: (text: string, opts?: { omitUserMessage?: boolean }) => void;
  approve: (messageId: number) => void;
  requestChanges: (messageId: number) => void;
  cancel: () => void;
  /** True after Stop while a remote mutation is still in flight */
  isStopping: boolean;
  /** True while a remote runAgent request is outstanding */
  isRunPending: boolean;
};

function useMockAgent({ workflow, onEvent }: UseAgentOptions) {
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;

  React.useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [workflow.id]);

  const clearTimers = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const cancel = React.useCallback(() => {
    clearTimers();
    onEventRef.current({ kind: "status", status: "idle" });
  }, [clearTimers]);

  const schedule = React.useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  const run = React.useCallback(
    (userText: string) => {
      clearTimers();

      const script = agentScripts[workflow.id] ?? {
        statuses: [
          {
            action: "reading",
            path: "src/app/page.tsx",
            text: "Reading page.tsx…",
            thinking:
              "Inspecting the current page so the next edit matches the existing layout.",
          },
          {
            action: "building",
            path: "src/app/page.tsx",
            text: "Building page.tsx…",
            thinking:
              "Drafting a focused change for the request — keep the first viewport simple.",
          },
          {
            action: "editing",
            path: "src/app/page.tsx",
            text: "Applying edits…",
            thinking: "Writing the patch and preparing a reviewable diff.",
          },
        ],
        path: "src/app/page.tsx",
        before: `export default function Page() {\n  return <main>Hello</main>;\n}\n`,
        after: `export default function Page() {\n  return (\n    <main className="p-8">\n      <h1 className="text-3xl font-semibold">Ready</h1>\n      <p className="mt-2 text-muted-foreground">${userText.slice(0, 80)}</p>\n    </main>\n  );\n}\n`,
        summary: "Update page for the latest request",
        milestone: "Page update ready for review.",
      };
      let idCursor = nextId(workflow.messages);

      const userMsg: Msg = {
        id: ++idCursor,
        type: "text",
        from: "me",
        text: userText,
        time: nowTime(),
      };
      onEventRef.current({ kind: "append", message: userMsg });

      onEventRef.current({ kind: "status", status: "working" });

      const statusId = ++idCursor;
      let delay = 400;

      for (const step of script.statuses) {
        const captured = step;
        schedule(() => {
          onEventRef.current({
            kind: "upsert-status",
            message: {
              id: statusId,
              type: "agent-status",
              text: captured.text,
              action: captured.action,
              path: captured.path,
              thinking: captured.thinking,
              streaming: true,
              time: nowTime(),
            },
          });
        }, delay);
        delay += 900;
      }

      schedule(() => {
        onEventRef.current({
          kind: "upsert-status",
          message: {
            id: statusId,
            type: "agent-status",
            text: `Edited ${script.path.split("/").pop() ?? script.path}`,
            action: "edited",
            path: script.path,
            thinking: script.statuses.at(-1)?.thinking,
            streaming: false,
            time: nowTime(),
          },
        });
        onEventRef.current({
          kind: "patch-workspace",
          path: script.path,
          contents: script.after,
          edited: true,
        });
      }, delay);
      delay += 300;

      const diffId = ++idCursor;
      schedule(() => {
        onEventRef.current({
          kind: "append",
          message: {
            id: diffId,
            type: "diff",
            path: script.path,
            before: script.before,
            after: script.after,
            summary: script.summary,
            time: nowTime(),
          },
        });
      }, delay);
      delay += 400;

      const approvalId = ++idCursor;
      schedule(() => {
        onEventRef.current({
          kind: "append",
          message: {
            id: approvalId,
            type: "approval",
            text: "Diff ready for review — approve to mark this workflow done.",
            resolved: null,
            time: nowTime(),
          },
        });
        onEventRef.current({ kind: "status", status: "needs-review" });
        onEventRef.current({ kind: "done" });
      }, delay);
    },
    [clearTimers, schedule, workflow.id, workflow.messages],
  );

  const approve = React.useCallback(
    (messageId: number) => {
      const script = agentScripts[workflow.id];
      onEventRef.current({
        kind: "resolve-approval",
        messageId,
        resolved: true,
      });
      onEventRef.current({
        kind: "append",
        message: {
          id: Date.now(),
          type: "milestone",
          text: script?.milestone ?? "Workflow complete.",
          time: nowTime(),
        },
      });
      onEventRef.current({ kind: "status", status: "done" });
    },
    [workflow.id],
  );

  const requestChanges = React.useCallback((messageId: number) => {
    onEventRef.current({
      kind: "resolve-approval",
      messageId,
      resolved: false,
    });
    onEventRef.current({
      kind: "append",
      message: {
        id: Date.now(),
        type: "text",
        from: "agent",
        text: "Understood — tell me what to change and I'll take another pass.",
        time: nowTime(),
      },
    });
    onEventRef.current({ kind: "status", status: "idle" });
  }, []);

  return {
    run: (text: string) => run(text),
    approve,
    requestChanges,
    cancel,
    isStopping: false,
    isRunPending: false,
  };
}

function useRemoteAgent({
  workflow,
  onEvent,
  onPreviewUrl,
  onContentRootHash,
  onJobStarted,
  model = "auto",
  effort = "high",
}: UseAgentOptions): AgentControls {
  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;
  const onPreviewUrlRef = React.useRef(onPreviewUrl);
  onPreviewUrlRef.current = onPreviewUrl;
  const onContentRootHashRef = React.useRef(onContentRootHash);
  onContentRootHashRef.current = onContentRootHash;
  const onJobStartedRef = React.useRef(onJobStarted);
  onJobStartedRef.current = onJobStarted;

  const stopRequestedRef = React.useRef(false);
  const [isStopping, setIsStopping] = React.useState(false);

  const finishStopped = React.useCallback(() => {
    stopRequestedRef.current = false;
    setIsStopping(false);
    onEventRef.current({
      kind: "append",
      message: {
        id: Date.now(),
        type: "text",
        from: "agent",
        text: "Stopped — the previous run may have left partial workspace changes. Review files before sending a new instruction.",
        time: nowTime(),
      },
    });
    onEventRef.current({ kind: "status", status: "idle" });
  }, []);

  const cancelJobMutation = api.workflow.cancelAgentJob.useMutation();

  const runMutation = api.workflow.runAgent.useMutation({
    onSuccess: (data) => {
      if (stopRequestedRef.current) {
        if (data.jobId) {
          cancelJobMutation.mutate({ workflowId: workflow.id });
        }
        finishStopped();
        return;
      }
      for (const event of data.events) {
        onEventRef.current(event);
      }
      if (data.previewUrl && onPreviewUrlRef.current) {
        onPreviewUrlRef.current(data.previewUrl);
      }
      if (data.jobId && onJobStartedRef.current) {
        onJobStartedRef.current(data.jobId);
      }
    },
    onError: (err) => {
      if (stopRequestedRef.current) {
        finishStopped();
        return;
      }
      onEventRef.current({
        kind: "append",
        message: {
          id: Date.now(),
          type: "text",
          from: "agent",
          text: `Agent error: ${err.message}`,
          time: nowTime(),
        },
      });
      onEventRef.current({ kind: "status", status: "idle" });
    },
  });

  const run = React.useCallback(
    (userText: string, opts?: { omitUserMessage?: boolean }) => {
      if (runMutation.isPending || stopRequestedRef.current) return;
      stopRequestedRef.current = false;
      setIsStopping(false);

      // Optimistic working state — harness job outlives this request.
      let idCursor = nextId(workflow.messages);
      if (!opts?.omitUserMessage) {
        onEventRef.current({
          kind: "append",
          message: {
            id: ++idCursor,
            type: "text",
            from: "me",
            text: userText,
            time: nowTime(),
          },
        });
      }
      onEventRef.current({ kind: "status", status: "working" });
      onEventRef.current({
        kind: "upsert-status",
        message: {
          id: ++idCursor,
          type: "agent-status",
          text: "Working…",
          action: "working",
          path: "sandbox",
          thinking:
            "Agent job started — safe to leave this page; we'll ping when it's done.",
          streaming: true,
          time: nowTime(),
        },
      });

      runMutation.mutate({
        workflowId: workflow.id,
        prompt: userText,
        messageIdStart: idCursor,
        model,
        effort,
        files: workflow.workspace.map((f) => ({
          path: f.path,
          contents: f.contents,
        })),
        omitUserMessage: true,
      });
    },
    [runMutation, workflow.id, workflow.messages, workflow.workspace, model, effort],
  );

  const approve = React.useCallback((messageId: number) => {
    onEventRef.current({
      kind: "resolve-approval",
      messageId,
      resolved: true,
    });
    onEventRef.current({
      kind: "append",
      message: {
        id: Date.now(),
        type: "milestone",
        text: "Workflow complete.",
        time: nowTime(),
      },
    });
    onEventRef.current({ kind: "status", status: "done" });
  }, []);

  const requestChanges = React.useCallback((messageId: number) => {
    onEventRef.current({
      kind: "resolve-approval",
      messageId,
      resolved: false,
    });
    onEventRef.current({
      kind: "append",
      message: {
        id: Date.now(),
        type: "text",
        from: "agent",
        text: "Understood — tell me what to change and I'll take another pass.",
        time: nowTime(),
      },
    });
    onEventRef.current({ kind: "status", status: "idle" });
  }, []);

  const cancel = React.useCallback(() => {
    stopRequestedRef.current = true;
    setIsStopping(true);
    cancelJobMutation.mutate({ workflowId: workflow.id });
    onEventRef.current({
      kind: "upsert-status",
      message: {
        id: Date.now(),
        type: "agent-status",
        text: "Stopping…",
        action: "stopping",
        thinking: "Cancelling the background agent job…",
        streaming: true,
        time: nowTime(),
      },
    });
    // Reconcile will land cancelled/failed; clear local stopping shortly.
    window.setTimeout(() => {
      if (stopRequestedRef.current) finishStopped();
    }, 1500);
  }, [cancelJobMutation, workflow.id, finishStopped]);

  return {
    run,
    approve,
    requestChanges,
    cancel,
    isStopping,
    // Pending only while start request is open — background job uses status=working.
    isRunPending: runMutation.isPending || workflow.status === "working",
  };
}

export function useAgent(options: UseAgentOptions): AgentControls {
  const { data: infra } = api.workflow.isEnabled.useQuery();
  const mock = useMockAgent(options);
  const remote = useRemoteAgent(options);

  // Harness URL can be set while the model key is missing — mock keeps
  // WorkingCard / thinking / diff interaction visible during local design.
  const forceMock =
    process.env.NEXT_PUBLIC_MOCK_AGENT === "1" ||
    process.env.NEXT_PUBLIC_MOCK_AGENT === "true";

  if (forceMock || !infra?.enabled) {
    return mock;
  }
  return remote;
}

export function applyWorkspacePatch(
  workspace: WorkspaceFile[],
  path: string,
  contents: string,
  edited?: boolean,
): WorkspaceFile[] {
  const exists = workspace.some((f) => f.path === path);
  if (exists) {
    return workspace.map((f) =>
      f.path === path ? { ...f, contents, edited: edited ?? f.edited } : f,
    );
  }
  return [
    ...workspace,
    { path, contents, language: "typescript", edited: edited ?? true },
  ];
}
