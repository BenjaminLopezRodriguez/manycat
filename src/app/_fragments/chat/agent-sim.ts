"use client";

import * as React from "react";

import { api } from "@/trpc/react";
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

export type AgentEvent =
  | { kind: "status"; status: Workflow["status"] }
  | { kind: "append"; message: Msg }
  | {
      kind: "patch-workspace";
      path: string;
      contents: string;
      edited?: boolean;
    }
  | { kind: "resolve-approval"; messageId: number; resolved: boolean }
  | { kind: "done" };

type UseAgentOptions = {
  workflow: Workflow;
  onEvent: (event: AgentEvent) => void;
  onPreviewUrl?: (url: string) => void;
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

  const cancel = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const schedule = React.useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  const run = React.useCallback(
    (userText: string) => {
      cancel();

      const script = agentScripts[workflow.id];
      let idCursor = nextId(workflow.messages);

      const userMsg: Msg = {
        id: ++idCursor,
        type: "text",
        from: "me",
        text: userText,
        time: nowTime(),
      };
      onEventRef.current({ kind: "append", message: userMsg });

      if (!script) {
        onEventRef.current({
          kind: "append",
          message: {
            id: ++idCursor,
            type: "text",
            from: "agent",
            text: "No agent script for this workflow yet — try another one.",
            time: nowTime(),
          },
        });
        return;
      }

      onEventRef.current({ kind: "status", status: "working" });

      let delay = 400;

      for (const statusText of script.statuses) {
        const statusId = ++idCursor;
        const captured = statusText;
        schedule(() => {
          onEventRef.current({
            kind: "append",
            message: {
              id: statusId,
              type: "agent-status",
              text: captured,
              streaming: true,
              time: nowTime(),
            },
          });
        }, delay);
        delay += 700;
      }

      schedule(() => {
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
    [cancel, schedule, workflow.id, workflow.messages],
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

  return { run, approve, requestChanges, cancel };
}

function useRemoteAgent({
  workflow,
  onEvent,
  onPreviewUrl,
}: UseAgentOptions) {
  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;

  const runMutation = api.workflow.runAgent.useMutation({
    onSuccess: (data) => {
      for (const event of data.events) {
        onEventRef.current(event as AgentEvent);
      }
      if (data.previewUrl && onPreviewUrl) {
        onPreviewUrl(data.previewUrl);
      }
    },
    onError: (err) => {
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
    (userText: string) => {
      runMutation.mutate({
        workflowId: workflow.id,
        prompt: userText,
        messageIdStart: nextId(workflow.messages),
      });
    },
    [runMutation, workflow.id, workflow.messages],
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
    /* remote runs are not cancellable in v1 */
  }, []);

  return { run, approve, requestChanges, cancel };
}

export function useAgent(options: UseAgentOptions) {
  const { data: infra } = api.workflow.isEnabled.useQuery();
  const mock = useMockAgent(options);
  const remote = useRemoteAgent(options);

  if (infra?.enabled) {
    return remote;
  }
  return mock;
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
