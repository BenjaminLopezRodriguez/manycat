import { index, pgTableCreator, primaryKey } from "drizzle-orm/pg-core";

/**
 * Multi-project schema prefix for Manycat tables.
 * @see https://orm.drizzle.team/docs/goodies
 */
export const createTable = pgTableCreator((name) => `manycat_${name}`);

/** Provider-agnostic account (GitHub login today; Google later). */
export const accounts = createTable(
  "account",
  (d) => ({
    id: d.varchar({ length: 128 }).primaryKey(),
    billingPlan: d
      .varchar({ length: 16 })
      .$type<"free" | "metered" | "sub">()
      .notNull()
      .default("free"),
    computeUsedCents: d.integer().notNull().default(0),
    computePeriodStart: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("account_billing_idx").on(t.billingPlan)],
);

/**
 * User project / workflow metadata.
 * Content lives in workload plane (sandbox / future S3); this row is control-plane only.
 */
export const projects = createTable(
  "project",
  (d) => ({
    id: d.varchar({ length: 64 }).notNull(),
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 256 }).notNull(),
    /** Optional GitHub repo `owner/repo` when imported. */
    githubRepo: d.varchar({ length: 512 }),
    /** Future virtual-git merkle root (S3 content-addressed tree). */
    contentRootHash: d.varchar({ length: 128 }),
    /** `github` | `virtual` — ContentStore backend hint. */
    contentBackend: d
      .varchar({ length: 32 })
      .$type<"github" | "virtual">()
      .notNull()
      .default("github"),
    /** Future common-prompt template catalog id. */
    templateId: d.varchar({ length: 128 }),
    railwayServiceId: d.varchar({ length: 128 }),
    railwayDomain: d.varchar({ length: 512 }),
    /** Latest Railway deployment id for async deploy-debug polling. */
    railwayDeploymentId: d.varchar({ length: 128 }),
    /** Async deploy-debug state machine status. */
    deployJobStatus: d
      .varchar({ length: 32 })
      .$type<
        | "idle"
        | "deploying"
        | "compiling"
        | "debugging"
        | "shipping"
        | "verifying"
        | "ready"
        | "failed"
      >()
      .notNull()
      .default("idle"),
    compileAttempt: d.integer().notNull().default(0),
    shipAttempt: d.integer().notNull().default(0),
    lastCompileErrorHash: d.varchar({ length: 64 }),
    lastShipErrorHash: d.varchar({ length: 64 }),
    /** Last DeployDebugBundle + attempt history (sanitized). */
    lastDeployDebugBundle: d.jsonb().$type<Record<string, unknown>>(),
    /** Background harness job for deploy_debug mode. */
    deployDebugJobId: d.varchar({ length: 64 }),
    mirrorGithubRepo: d.varchar({ length: 512 }),
    neonMode: d.varchar({ length: 16 }).$type<"shared" | "dedicated">(),
    neonSchema: d.varchar({ length: 128 }),
    neonRole: d.varchar({ length: 128 }),
    neonRolePasswordEnc: d.text(),
    neonProjectId: d.varchar({ length: 128 }),
    /** UI workflow status for restore after refresh. */
    status: d
      .varchar({ length: 32 })
      .$type<"idle" | "working" | "needs-review" | "done">()
      .notNull()
      .default("idle"),
    /** Background agent-harness job id (survives page leave). */
    agentJobId: d.varchar({ length: 64 }),
    /** Outcome of the last finished/cancelled agent run. */
    lastRunOutcome: d
      .varchar({ length: 16 })
      .$type<"ok" | "failed" | "budget" | null>(),
    /** Unread rail badge — set when a background run finishes. */
    unread: d.integer().notNull().default(0),
    /** Tokens already billed for the in-flight agent job (incremental). */
    agentBilledPromptTokens: d.integer().notNull().default(0),
    agentBilledCompletionTokens: d.integer().notNull().default(0),
    /**
     * Durable Build ContextPack (origin, research, codebase brief, plan).
     * Source of truth across Vercel instances — not process memory.
     */
    contextPack: d.jsonb().$type<Record<string, unknown>>(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index("project_account_idx").on(t.accountId),
  ],
);

/**
 * Chat messages for a workflow (JSON payload matches UI Msg shape).
 */
export const workflowMessages = createTable(
  "workflow_message",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    workflowId: d.varchar({ length: 64 }).notNull(),
    seq: d.integer().notNull(),
    payload: d.jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    index("workflow_message_scope_idx").on(t.accountId, t.workflowId, t.seq),
  ],
);

/**
 * Workspace file snapshot persisted for refresh / multi-device restore.
 */
export const workspaceFiles = createTable(
  "workspace_file",
  (d) => ({
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    workflowId: d.varchar({ length: 64 }).notNull(),
    path: d.varchar({ length: 512 }).notNull(),
    contents: d.text().notNull(),
    updatedAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.accountId, t.workflowId, t.path] }),
    index("workspace_file_scope_idx").on(t.accountId, t.workflowId),
  ],
);

/**
 * Warm Railway workload services ready for claim on Run.
 * @see docs/superpowers/specs/2026-07-19-railway-warm-pool-design.md
 */
export type RailwayPoolSlotStatus =
  | "hot"
  | "claimed"
  | "draining"
  | "recycling"
  | "broken";

export const railwayPoolSlots = createTable(
  "railway_pool_slot",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    railwayServiceId: d.varchar({ length: 128 }).notNull(),
    railwayDomain: d.varchar({ length: 512 }),
    status: d
      .varchar({ length: 32 })
      .$type<RailwayPoolSlotStatus>()
      .notNull()
      .default("hot"),
    accountId: d.varchar({ length: 128 }),
    workflowId: d.varchar({ length: 64 }),
    claimedAt: d.timestamp({ withTimezone: true }),
    lastHotAt: d.timestamp({ withTimezone: true }),
    generation: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("railway_pool_service_idx").on(t.railwayServiceId),
    index("railway_pool_status_idx").on(t.status),
  ],
);

/**
 * Reserved shape for prompt-linked change history (virtual git / agent commits).
 * Not written heavily in Phase 1 — schema seam for Phase 4+.
 */
export const projectChanges = createTable(
  "project_change",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    workflowId: d.varchar({ length: 64 }).notNull(),
    parentId: d.varchar({ length: 64 }),
    treeHash: d.varchar({ length: 128 }),
    diff: d.text(),
    prompt: d.text(),
    templateId: d.varchar({ length: 128 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    index("project_change_scope_idx").on(t.accountId, t.workflowId),
  ],
);

/** Work plan-over-time schedule (Manycat is source of truth). */
export type WorkPlanStatus = "active" | "paused" | "ended";
export type WorkPlanCadence =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "interval"; hours: number };

export const workPlans = createTable(
  "work_plan",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    workflowId: d.varchar({ length: 64 }).notNull(),
    startsAt: d.timestamp({ withTimezone: true }).notNull(),
    endsAt: d.timestamp({ withTimezone: true }).notNull(),
    cadence: d.jsonb().$type<WorkPlanCadence>().notNull(),
    timezone: d.varchar({ length: 64 }).notNull().default("UTC"),
    promptTemplate: d.text().notNull().default(""),
    status: d
      .varchar({ length: 16 })
      .$type<WorkPlanStatus>()
      .notNull()
      .default("active"),
    nextDueAt: d.timestamp({ withTimezone: true }),
    googleEventId: d.varchar({ length: 256 }),
    /** Email/notify when a timed prompt fires. */
    notify: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("work_plan_account_idx").on(t.accountId),
    index("work_plan_due_idx").on(t.status, t.nextDueAt),
    index("work_plan_workflow_idx").on(t.accountId, t.workflowId),
  ],
);

export type WorkOccurrenceStatus =
  | "pending"
  | "notified"
  | "running"
  | "done"
  | "skipped";

export const workPlanOccurrences = createTable(
  "work_plan_occurrence",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    planId: d
      .varchar({ length: 64 })
      .notNull()
      .references(() => workPlans.id, { onDelete: "cascade" }),
    dueAt: d.timestamp({ withTimezone: true }).notNull(),
    status: d
      .varchar({ length: 16 })
      .$type<WorkOccurrenceStatus>()
      .notNull()
      .default("pending"),
    firedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    index("work_occurrence_plan_idx").on(t.planId, t.dueAt),
    index("work_occurrence_status_idx").on(t.status),
  ],
);

/** Join-link ACL for shared Work chats. */
export const workSessionMembers = createTable(
  "work_session_member",
  (d) => ({
    workflowId: d.varchar({ length: 64 }).notNull(),
    /** Owner of the underlying `projects` row (messages live here). */
    ownerAccountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: d
      .varchar({ length: 16 })
      .$type<"owner" | "member">()
      .notNull()
      .default("member"),
    joinedAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.workflowId, t.accountId] }),
    index("work_member_account_idx").on(t.accountId),
    index("work_member_owner_idx").on(t.ownerAccountId, t.workflowId),
  ],
);

export const workJoinTokens = createTable(
  "work_join_token",
  (d) => ({
    token: d.varchar({ length: 64 }).primaryKey(),
    workflowId: d.varchar({ length: 64 }).notNull(),
    ownerAccountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdBy: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    expiresAt: d.timestamp({ withTimezone: true }),
    revokedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [index("work_join_workflow_idx").on(t.workflowId)],
);

/** Work intelligence notes mined from threads. */
export const workNotes = createTable(
  "work_note",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    workflowId: d.varchar({ length: 64 }).notNull(),
    ownerAccountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sourceMessageId: d.varchar({ length: 64 }),
    authorAccountId: d.varchar({ length: 128 }),
    authorLabel: d.varchar({ length: 128 }),
    text: d.text().notNull(),
    summary: d.varchar({ length: 512 }).notNull(),
    usedInPlanId: d.varchar({ length: 64 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    index("work_note_workflow_idx").on(t.workflowId, t.createdAt),
    index("work_note_unused_idx").on(t.workflowId, t.usedInPlanId),
  ],
);

/** OAuth tokens for connectors (Google Calendar mirror, etc.). */
export const oauthConnections = createTable(
  "oauth_connection",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    accountId: d
      .varchar({ length: 128 })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: d
      .varchar({ length: 32 })
      .$type<"google_calendar">()
      .notNull(),
    accessTokenEnc: d.text().notNull(),
    refreshTokenEnc: d.text(),
    scopes: d.text().notNull().default(""),
    expiresAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("oauth_connection_account_idx").on(t.accountId, t.provider),
  ],
);

/** Legacy example table — keep until callers migrate. */
export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)],
);
