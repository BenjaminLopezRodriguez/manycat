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
  kind: "vercel" | "custom" | "none";
  // TODO(blacksmith): add kind "blacksmith" — fires a GitHub Actions
  // workflow_dispatch on Blacksmith runners: blacksmith?: { workflow: string; ref?: string }.
  // Preview-domain mapping attaches here too: lastRun.url would resolve to a stable
  // per-project subdomain (e.g. https://<project-slug>.preview.manycat.dev) instead
  // of a one-off deploy URL like Vercel's.
  vercel?: { projectName?: string };
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

export const initialWorkflows: Workflow[] = [
  {
    id: "checkout-bug",
    name: "Fix checkout bug",
    initials: "CK",
    avatarClass: "bg-amber-200 text-amber-900",
    repo: "shop/web",
    status: "needs-review",
    unread: 2,
    messages: [
      {
        id: 1,
        type: "text",
        from: "me",
        text: "Checkout total ignores tax — can you fix CartTotal?",
        time: "09:12",
      },
      {
        id: 2,
        type: "agent-status",
        text: "Reading src/components/CartTotal.tsx…",
        time: "09:12",
      },
      {
        id: 3,
        type: "agent-status",
        text: "Applying tax-inclusive total…",
        time: "09:13",
      },
      {
        id: 4,
        type: "diff",
        path: "src/components/CartTotal.tsx",
        before: checkoutCartBefore,
        after: checkoutCartAfter,
        summary: "Include taxRate when summing cart items",
        time: "09:14",
      },
      {
        id: 5,
        type: "approval",
        text: "Diff ready for review — approve to mark this workflow done.",
        resolved: null,
        time: "09:14",
      },
    ],
    workspace: [
      {
        path: "src/components/CartTotal.tsx",
        contents: checkoutCartAfter,
        language: "typescript",
        edited: true,
      },
      {
        path: "src/lib/money.ts",
        contents: `export function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
`,
        language: "typescript",
      },
      {
        path: "package.json",
        contents: `{
  "name": "shop-web",
  "version": "0.4.1"
}
`,
        language: "json",
      },
    ],
  },
  {
    id: "landing-v2",
    name: "Landing page v2",
    initials: "LP",
    avatarClass: "bg-sky-200 text-sky-900",
    repo: "manycat/marketing",
    status: "idle",
    messages: [
      {
        id: 1,
        type: "text",
        from: "me",
        text: "Rewrite the hero to match the brand — navy + neon green, one CTA.",
        time: "08:02",
      },
      {
        id: 2,
        type: "text",
        from: "agent",
        text: "Got it. Send another message when you want me to start.",
        time: "08:03",
      },
    ],
    workspace: [
      {
        path: "src/components/Hero.tsx",
        contents: landingHeroBefore,
        language: "typescript",
      },
      {
        path: "src/app/page.tsx",
        contents: `import { Hero } from "@/components/Hero";

export default function Page() {
  return <Hero />;
}
`,
        language: "typescript",
      },
    ],
  },
  {
    id: "auth-hardening",
    name: "Auth hardening",
    initials: "AH",
    avatarClass: "bg-rose-200 text-rose-900",
    repo: "platform/api",
    status: "done",
    messages: [
      {
        id: 1,
        type: "text",
        from: "me",
        text: "login() never checks the password hash — please fix.",
        time: "Yesterday",
      },
      {
        id: 2,
        type: "diff",
        path: "src/auth/login.ts",
        before: authLoginBefore,
        after: authLoginAfter,
        summary: "Verify password hash before returning the user",
        time: "Yesterday",
      },
      {
        id: 3,
        type: "approval",
        text: "Diff ready for review — approve to mark this workflow done.",
        resolved: true,
        time: "Yesterday",
      },
      {
        id: 4,
        type: "milestone",
        text: "Auth hardening shipped — password verification is live.",
        time: "Yesterday",
      },
    ],
    workspace: [
      {
        path: "src/auth/login.ts",
        contents: authLoginAfter,
        language: "typescript",
        edited: true,
      },
      {
        path: "src/auth/password.ts",
        contents: `export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
`,
        language: "typescript",
      },
    ],
  },
];

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

