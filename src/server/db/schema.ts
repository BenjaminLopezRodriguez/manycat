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
