import { slugify } from "@/lib/slug";

export type WorkflowStatus = "idle" | "working" | "needs-review" | "done";

export type WorkspaceFile = {
  path: string;
  contents: string;
  language?: string;
  /** Set when the agent has edited this file in the current run */
  edited?: boolean;
};

type MsgBase = {
  id: number;
  time: string;
};

export type TextMsg = MsgBase & {
  type: "text";
  from: "me" | "agent";
  text: string;
};

export type AgentStatusMsg = MsgBase & {
  type: "agent-status";
  text: string;
  /** True while the agent is still streaming this status line */
  streaming?: boolean;
};

export type DiffMsg = MsgBase & {
  type: "diff";
  path: string;
  before: string;
  after: string;
  summary: string;
};

export type ApprovalMsg = MsgBase & {
  type: "approval";
  text: string;
  /** null = pending, true = approved, false = changes requested */
  resolved: boolean | null;
};

export type MilestoneMsg = MsgBase & {
  type: "milestone";
  text: string;
};

export type Msg =
  TextMsg | AgentStatusMsg | DiffMsg | ApprovalMsg | MilestoneMsg;

export type Workflow = {
  id: string;
  name: string;
  initials: string;
  avatarClass: string;
  repo: string;
  status: WorkflowStatus;
  unread?: number;
  messages: Msg[];
  workspace: WorkspaceFile[];
};

export type RunConfig = {
  kind: "vercel" | "railway" | "custom" | "none";
  // TODO(blacksmith): add kind "blacksmith" — fires a GitHub Actions
  // workflow_dispatch on Blacksmith runners: blacksmith?: { workflow: string; ref?: string }.
  vercel?: { projectName?: string };
  /** Railway workload-plane deploy (public *.up.railway.app). */
  railway?: { githubRepo?: string };
  custom?: { command: string };
};

export type LastRun = {
  status: "running" | "success" | "failed";
  url?: string;
  startedAt: string;
  finishedAt?: string;
  log?: string;
};

export type Project = {
  id: string;
  name: string;
  repo: string;
  workflowIds: string[];
  runConfig: RunConfig;
  lastRun?: LastRun;
};

export function messagePreview(m: Msg): string {
  switch (m.type) {
    case "text":
      return m.from === "me" ? `You: ${m.text}` : m.text;
    case "agent-status":
      return m.text;
    case "diff":
      return `Diff ready: ${m.path}`;
    case "approval":
      return m.text;
    case "milestone":
      return m.text;
  }
}

const checkoutCartBefore = `export function CartTotal({ items }: { items: Item[] }) {
  const total = items.reduce((sum, i) => sum + i.price, 0);
  return <span>\${total.toFixed(2)}</span>;
}
`;

const checkoutCartAfter = `export function CartTotal({ items }: { items: Item[] }) {
  // Include tax so the checkout total matches the charge amount
  const total = items.reduce(
    (sum, i) => sum + i.price * (1 + (i.taxRate ?? 0)),
    0,
  );
  return <span>\${total.toFixed(2)}</span>;
}
`;

const landingHeroBefore = `export function Hero() {
  return (
    <section>
      <h1>Welcome</h1>
      <p>Ship faster with our platform.</p>
    </section>
  );
}
`;

const landingHeroAfter = `export function Hero() {
  return (
    <section className="relative min-h-[70vh] overflow-hidden">
      <h1 className="text-5xl font-semibold tracking-tight">
        manycat
      </h1>
      <p className="mt-4 max-w-md text-lg text-muted-foreground">
        Agentic workflows that feel like a chat.
      </p>
      <a href="/start" className="mt-8 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
        Start a workflow
      </a>
    </section>
  );
}
`;

const authLoginBefore = `export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("Invalid credentials");
  return user;
}
`;

const authLoginAfter = `export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("Invalid credentials");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  return { id: user.id, email: user.email };
}
`;

export const initialWorkflows: Workflow[] = [];

/** Seeded edits the simulator applies when a user kicks off a workflow run */
export const agentScripts: Record<
  string,
  {
    statuses: string[];
    path: string;
    before: string;
    after: string;
    summary: string;
    milestone: string;
  }
> = {
  "checkout-bug": {
    statuses: [
      "Re-reading CartTotal against the latest cart schema…",
      "Confirming taxRate is optional on Item…",
      "Updating CartTotal…",
    ],
    path: "src/components/CartTotal.tsx",
    before: checkoutCartBefore,
    after: checkoutCartAfter,
    summary: "Include taxRate when summing cart items",
    milestone: "Checkout total now includes tax — ready to ship.",
  },
  "landing-v2": {
    statuses: [
      "Opening Hero.tsx…",
      "Drafting brand-aligned hero copy…",
      "Applying layout and CTA…",
    ],
    path: "src/components/Hero.tsx",
    before: landingHeroBefore,
    after: landingHeroAfter,
    summary: "Brand-first hero with single CTA",
    milestone: "Landing page v2 hero is ready for review.",
  },
  "auth-hardening": {
    statuses: [
      "Inspecting login flow…",
      "Wiring verifyPassword…",
      "Hardening credential check…",
    ],
    path: "src/auth/login.ts",
    before: authLoginBefore,
    after: authLoginAfter,
    summary: "Verify password hash before returning the user",
    milestone: "Auth hardening shipped — password verification is live.",
  },
};

export function deriveProjectsFromWorkflows(workflows: Workflow[]): Project[] {
  const byRepo = new Map<string, Project>();
  for (const w of workflows) {
    const existing = byRepo.get(w.repo);
    if (existing) {
      existing.workflowIds.push(w.id);
      continue;
    }
    byRepo.set(w.repo, {
      id: slugify(w.repo),
      name: w.repo.split("/").pop() ?? w.repo,
      repo: w.repo,
      workflowIds: [w.id],
      runConfig: { kind: "none" },
    });
  }
  return [...byRepo.values()];
}

