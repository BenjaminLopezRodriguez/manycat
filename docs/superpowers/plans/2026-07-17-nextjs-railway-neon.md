# Next.js Railway + Neon App Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy prompt/virtual and GitHub apps to Railway as Next.js (build/start on `$PORT`), mirror virtual trees to a Manycat GitHub org, and provision Postgres — shared schema+role for free, dedicated Neon project for paying — without ever injecting control-plane secrets into workloads.

**Architecture:** Control plane (Vercel Manycat) owns mirror push, Neon provisioning, and Railway GraphQL creates in the workload project only. Free tenants get `CREATE SCHEMA` + `LOGIN` role with grants only on that schema; paying tenants get a Neon project whose connection URI is fetched on demand at inject time. `search_path` is convenience; role grants are the isolation wall.

**Tech Stack:** Next.js 15 / tRPC / Drizzle / `postgres` / Railway GraphQL / Neon Management API / GitHub Contents API / Vitest

**Spec:** `docs/superpowers/specs/2026-07-17-nextjs-railway-neon-design.md`

## Global Constraints

- Never put control `DATABASE_URL`, Auth secrets, or Railway control tokens into user services.
- Workload services stay in `RAILWAY_WORKLOAD_*` only (`docs/planes.md`).
- Service name remains `mc-{account}-{workflow}`.
- **Fail loud — no silent dedicated→shared fallback.** If dedicated Neon provision fails for a paying account, abort the deploy. Do not “gracefully” fall back to the shared pool.
- **`search_path` is not isolation.** Free-tier apps must never receive the shared owner/`NEON_SHARED_DATABASE_URL` credentials. Each app gets its own `LOGIN` role with grants only on its schema.
- `GITHUB_MIRROR_TOKEN` must be a GitHub App installation token or fine-grained PAT scoped to `GITHUB_MIRROR_ORG` only — never a classic PAT on a personal account.
- Do not store dedicated connection strings at rest; fetch via Neon API at inject time.
- `REVOKE ALL ON SCHEMA public FROM PUBLIC` runs once at shared-DB setup, not per-app provision.
- Do not rely on admin `ALTER DEFAULT PRIVILEGES` for app-created tables; test with tables created by the app role post-provision.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/env.js`, `.env.example` | Mirror + Neon env (optional until deploy) |
| `src/server/db/schema.ts`, `drizzle/0002_neon_mirror.sql` | Project columns for mirror/neon metadata |
| `src/server/neon/names.ts` | Sanitize schema/role identifiers |
| `src/server/neon/crypto.ts` | Encrypt/decrypt shared role passwords |
| `src/server/neon/shared-setup.ts` | One-time shared DB harden |
| `src/server/neon/provision.ts` | Plan-gated ensure + workload URL |
| `src/server/content/scaffold-next.ts` | Next.js App Router template + `railway.toml` |
| `src/server/content/scaffold.ts` | Route prompt create to Next by default |
| `src/server/github/mirror.ts` | Create/update org repo + push tree |
| `src/server/railway/client.ts` | Inject workload DB vars + Next start hints |
| `src/server/api/routers/project.ts` | Mirror → Neon → Railway in `run` |
| `src/server/api/routers/workflow.ts` | `templateId: "next-app"` on create |
| `src/app/_fragments/chat/deployments-panel.tsx` | Run virtual projects; show neon mode |
| `vitest.config.ts`, `src/server/neon/*.test.ts` | Unit + isolation tests |
| `package.json` | `test` script + vitest |

---

### Task 1: Env + schema columns

**Files:**
- Modify: `src/env.js`
- Modify: `.env.example`
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/0002_neon_mirror.sql`

**Interfaces:**
- Produces: `projects.mirrorGithubRepo`, `neonMode`, `neonSchema`, `neonRole`, `neonRolePasswordEnc`, `neonProjectId`; env keys listed below

- [ ] **Step 1: Extend `src/env.js` server schema** (all optional — deploy fails loud if missing when needed)

```js
GITHUB_MIRROR_TOKEN: z.string().min(1).optional(),
GITHUB_MIRROR_ORG: z.string().min(1).optional(),
NEON_API_KEY: z.string().min(1).optional(),
NEON_ORG_ID: z.string().min(1).optional(),
NEON_SHARED_PROJECT_ID: z.string().min(1).optional(),
NEON_SHARED_DATABASE_URL: z.string().url().optional(),
APP_DB_ENCRYPTION_KEY: z.string().min(32).optional(),
```

Add matching `runtimeEnv` entries.

- [ ] **Step 2: Document in `.env.example`**

```bash
# GitHub mirror (org-scoped App token or fine-grained PAT — NOT classic personal PAT)
# GITHUB_MIRROR_TOKEN=
# GITHUB_MIRROR_ORG=manycat-apps

# Neon — app data (NEON_SHARED_DATABASE_URL is admin-only; never inject into Railway)
# NEON_API_KEY=
# NEON_ORG_ID=
# NEON_SHARED_PROJECT_ID=
# NEON_SHARED_DATABASE_URL=
# APP_DB_ENCRYPTION_KEY=  # 32+ chars; encrypts free-tier role passwords at rest
```

- [ ] **Step 3: Extend `projects` in `src/server/db/schema.ts`**

```ts
mirrorGithubRepo: d.varchar({ length: 512 }),
neonMode: d.varchar({ length: 16 }).$type<"shared" | "dedicated">(),
neonSchema: d.varchar({ length: 128 }),
neonRole: d.varchar({ length: 128 }),
neonRolePasswordEnc: d.text(),
neonProjectId: d.varchar({ length: 128 }),
```

- [ ] **Step 4: Add `drizzle/0002_neon_mirror.sql`**

```sql
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "mirrorGithubRepo" varchar(512);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonMode" varchar(16);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonSchema" varchar(128);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonRole" varchar(128);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonRolePasswordEnc" text;
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonProjectId" varchar(128);
```

- [ ] **Step 5: Commit**

```bash
git add src/env.js .env.example src/server/db/schema.ts drizzle/0002_neon_mirror.sql
git commit -m "Add mirror/Neon project columns and control-plane env seams."
```

---

### Task 2: Neon name sanitize + password crypto

**Files:**
- Create: `src/server/neon/names.ts`
- Create: `src/server/neon/crypto.ts`
- Create: `src/server/neon/names.test.ts`
- Create: `src/server/neon/crypto.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add vitest, `test` script)

**Interfaces:**
- Produces:
  - `tenantIdFromWorkflow(workflowId: string): string` — lowercase alphanumeric/underscore, max 48
  - `schemaNameFor(workflowId: string): string` → `app_{tenantId}`
  - `roleNameFor(workflowId: string): string` → `app_{tenantId}_role`
  - `encryptSecret(plain: string, key: string): string`
  - `decryptSecret(enc: string, key: string): string`
  - AES-256-GCM; key = sha256(APP_DB_ENCRYPTION_KEY) if key length ≠ 32 bytes

- [ ] **Step 1: Add vitest**

```bash
pnpm add -D vitest
```

`package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 2: Write failing tests** `src/server/neon/names.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { roleNameFor, schemaNameFor, tenantIdFromWorkflow } from "./names";

describe("neon names", () => {
  it("sanitizes workflow ids to safe identifiers", () => {
    expect(tenantIdFromWorkflow("Wf-ABC_123!")).toMatch(/^[a-z0-9_]+$/);
    expect(schemaNameFor("hello")).toBe("app_hello");
    expect(roleNameFor("hello")).toBe("app_hello_role");
  });

  it("does not start with a digit after prefix", () => {
    expect(schemaNameFor("9bad")).toMatch(/^app_[a-z]/);
  });
});
```

`src/server/neon/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

describe("neon crypto", () => {
  it("round-trips", () => {
    const key = "test-encryption-key-32chars-min!!";
    const enc = encryptSecret("s3cret", key);
    expect(enc).not.toContain("s3cret");
    expect(decryptSecret(enc, key)).toBe("s3cret");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
pnpm test
```

Expected: cannot find modules `./names` / `./crypto`

- [ ] **Step 4: Implement `names.ts` and `crypto.ts`**

```ts
// names.ts
export function tenantIdFromWorkflow(workflowId: string): string {
  let s = workflowId.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  if (!/^[a-z]/.test(s)) s = `t_${s}`;
  return s.slice(0, 48).replace(/_$/, "") || "app";
}
export function schemaNameFor(workflowId: string) {
  return `app_${tenantIdFromWorkflow(workflowId)}`;
}
export function roleNameFor(workflowId: string) {
  return `${schemaNameFor(workflowId)}_role`;
}
```

```ts
// crypto.ts — aes-256-gcm; payload = iv:tag:ciphertext base64 parts joined by '.'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(key: string) {
  return createHash("sha256").update(key).digest();
}

export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(payload: string, key: string): string {
  const [ivB, tagB, encB] = payload.split(".");
  if (!ivB || !tagB || !encB) throw new Error("Invalid ciphertext");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(key),
    Buffer.from(ivB, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encB, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/server/neon/
git commit -m "Add Neon identifier sanitization and role-password crypto."
```

---

### Task 3: Shared DB one-time harden + per-app role/schema provision

**Files:**
- Create: `src/server/neon/shared-setup.ts`
- Create: `src/server/neon/provision.ts`
- Create: `src/server/neon/isolation.test.ts`

**Interfaces:**
- Consumes: `schemaNameFor`, `roleNameFor`, `encryptSecret`, `decryptSecret`, `env`
- Produces:
  - `ensureSharedDbHardened(): Promise<void>`
  - `ensureAppDatabase(opts: { accountId: string; workflowId: string; plan: BillingPlan; existing?: ProjectNeonFields }): Promise<NeonProvisionResult>`
  - Types:

```ts
export type ProjectNeonFields = {
  neonMode?: "shared" | "dedicated" | null;
  neonSchema?: string | null;
  neonRole?: string | null;
  neonRolePasswordEnc?: string | null;
  neonProjectId?: string | null;
};

export type NeonProvisionResult = {
  neonMode: "shared" | "dedicated";
  neonSchema: string | null;
  neonRole: string | null;
  neonRolePasswordEnc: string | null;
  neonProjectId: string | null;
  /** Workload-safe URL only — never NEON_SHARED_DATABASE_URL or control DATABASE_URL */
  databaseUrl: string;
};
```

- [ ] **Step 1: Write isolation tests** (skip if `process.env.NEON_SHARED_DATABASE_URL` / `APP_DB_ENCRYPTION_KEY` unset)

```ts
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { ensureAppDatabase, ensureSharedDbHardened } from "./provision";

const adminUrl = process.env.NEON_SHARED_DATABASE_URL;
const key = process.env.APP_DB_ENCRYPTION_KEY;
const describeLive = adminUrl && key ? describe : describe.skip;

describeLive("shared neon tenant isolation", () => {
  const wfA = `iso_a_${randomBytes(4).toString("hex")}`;
  const wfB = `iso_b_${randomBytes(4).toString("hex")}`;
  let urlA = "";
  let urlB = "";

  afterAll(async () => {
    // best-effort cleanup via admin
  });

  it("hardens public once, then provisions two isolated roles", async () => {
    await ensureSharedDbHardened();
    await ensureSharedDbHardened(); // idempotent

    const a = await ensureAppDatabase({
      accountId: "acct",
      workflowId: wfA,
      plan: "free",
    });
    const b = await ensureAppDatabase({
      accountId: "acct",
      workflowId: wfB,
      plan: "free",
    });
    expect(a.databaseUrl).not.toBe(adminUrl);
    expect(b.databaseUrl).not.toBe(adminUrl);
    urlA = a.databaseUrl;
    urlB = b.databaseUrl;
  });

  it("app role can create and use its own table", async () => {
    const sql = postgres(urlA, { max: 1 });
    await sql`create table if not exists probe (id int primary key)`;
    await sql`insert into probe values (1)`;
    const rows = await sql`select id from probe`;
    expect(rows[0]?.id).toBe(1);
    await sql.end();
  });

  it("app A cannot read app B schema", async () => {
    const sqlB = postgres(urlB, { max: 1 });
    await sqlB`create table if not exists secret (v text)`;
    await sqlB`insert into secret values ('nope')`;
    await sqlB.end();

    const sqlA = postgres(urlA, { max: 1 });
    const schemaB = (await import("./names")).schemaNameFor(wfB);
    await expect(
      sqlA.unsafe(`select * from ${schemaB}.secret`),
    ).rejects.toThrow();
    await sqlA.end();
  });
});
```

- [ ] **Step 2: Run — skip or FAIL on missing impl**

```bash
pnpm test src/server/neon/isolation.test.ts
```

- [ ] **Step 3: Implement `shared-setup.ts`**

```ts
import postgres from "postgres";
import { env } from "@/env";

let hardened = false;

export async function ensureSharedDbHardened(): Promise<void> {
  if (hardened) return;
  const url = env.NEON_SHARED_DATABASE_URL;
  if (!url) throw new Error("NEON_SHARED_DATABASE_URL not configured");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
    // advisory: also revoke create on public from public if still present
    await sql.unsafe(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  } finally {
    await sql.end();
  }
  hardened = true;
}
```

Note: in-process `hardened` flag is enough for a single Node instance; idempotent SQL makes multi-instance safe. Do **not** call this revoke inside per-app provision.

- [ ] **Step 4: Implement shared branch of `provision.ts`**

```ts
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { env } from "@/env";
import type { BillingPlan } from "@/server/billing/budget";
import { decryptSecret, encryptSecret } from "./crypto";
import { roleNameFor, schemaNameFor } from "./names";
import { ensureSharedDbHardened } from "./shared-setup";

// types NeonProvisionResult / ProjectNeonFields as above

function assertNotControlUrl(url: string) {
  if (url === env.DATABASE_URL) {
    throw new Error("Refusing to use control DATABASE_URL as workload DB");
  }
  if (url === env.NEON_SHARED_DATABASE_URL) {
    throw new Error("Refusing to inject admin NEON_SHARED_DATABASE_URL into workload");
  }
}

function buildRoleUrl(adminUrl: string, role: string, password: string, schema: string) {
  const u = new URL(adminUrl);
  u.username = role;
  u.password = password;
  u.searchParams.set("options", `-csearch_path=${schema}`);
  return u.toString();
}

async function ensureShared(opts: {
  workflowId: string;
  existing?: ProjectNeonFields;
}): Promise<NeonProvisionResult> {
  const adminUrl = env.NEON_SHARED_DATABASE_URL;
  const key = env.APP_DB_ENCRYPTION_KEY;
  if (!adminUrl) throw new Error("NEON_SHARED_DATABASE_URL not configured");
  if (!key) throw new Error("APP_DB_ENCRYPTION_KEY not configured");

  await ensureSharedDbHardened();

  const schema = opts.existing?.neonSchema ?? schemaNameFor(opts.workflowId);
  const role = opts.existing?.neonRole ?? roleNameFor(opts.workflowId);
  let password: string;
  let passwordEnc: string;

  if (opts.existing?.neonRolePasswordEnc) {
    password = decryptSecret(opts.existing.neonRolePasswordEnc, key);
    passwordEnc = opts.existing.neonRolePasswordEnc;
  } else {
    password = randomBytes(24).toString("base64url");
    passwordEnc = encryptSecret(password, key);
  }

  const sql = postgres(adminUrl, { max: 1 });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    // CREATE ROLE if not exists — Postgres has no IF NOT EXISTS for roles pre-16 reliably; use DO block
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD '${password.replace(/'/g, "''")}';
      EXCEPTION WHEN duplicate_object THEN
        ALTER ROLE ${quoteIdent(role)} LOGIN PASSWORD '${password.replace(/'/g, "''")}';
      END $$;
    `);
    await sql.unsafe(`GRANT USAGE, CREATE ON SCHEMA ${quoteIdent(schema)} TO ${quoteIdent(role)}`);
    await sql.unsafe(`ALTER ROLE ${quoteIdent(role)} SET search_path TO ${quoteIdent(schema)}`);
    // Do NOT create tables as admin in this schema.
    // Do NOT REVOKE ALL ON SCHEMA public FROM PUBLIC here.
  } finally {
    await sql.end();
  }

  const databaseUrl = buildRoleUrl(adminUrl, role, password, schema);
  assertNotControlUrl(databaseUrl);

  return {
    neonMode: "shared",
    neonSchema: schema,
    neonRole: role,
    neonRolePasswordEnc: passwordEnc,
    neonProjectId: null,
    databaseUrl,
  };
}

function quoteIdent(id: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(id)) throw new Error(`Unsafe ident: ${id}`);
  return `"${id}"`;
}
```

Wire `ensureAppDatabase` to call `ensureShared` when `plan === "free"`. Dedicated branch is Task 4 — for now throw if plan is paying and dedicated not implemented yet, OR stub that throws `Error("dedicated neon not implemented")` so fail-loud is already correct.

- [ ] **Step 5: Run isolation tests with live env when available**

```bash
NEON_SHARED_DATABASE_URL=... APP_DB_ENCRYPTION_KEY=... pnpm test src/server/neon/isolation.test.ts
```

Expected: PASS (or skip if unset in CI)

- [ ] **Step 6: Commit**

```bash
git add src/server/neon/
git commit -m "Provision free-tier Neon with per-app role isolation."
```

---

### Task 4: Dedicated Neon provision (paying) — fail loud

**Files:**
- Modify: `src/server/neon/provision.ts`
- Create: `src/server/neon/dedicated.test.ts`

**Interfaces:**
- Consumes: `NEON_API_KEY`, `NEON_ORG_ID`
- Produces: dedicated branch of `ensureAppDatabase` returning `neonMode: "dedicated"`, `neonProjectId`, on-demand `databaseUrl`

- [ ] **Step 1: Write unit test with mocked fetch**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureAppDatabase } from "./provision";

afterEach(() => vi.unstubAllGlobals());

describe("dedicated neon", () => {
  it("fails loud without falling back to shared when API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      }),
    );
    // ensure env has NEON_API_KEY set in test via vi.stubEnv if needed
    await expect(
      ensureAppDatabase({
        accountId: "a",
        workflowId: "w1",
        plan: "sub",
      }),
    ).rejects.toThrow(/dedicated|Neon|boom/i);
  });
});
```

- [ ] **Step 2: Implement dedicated path**

```ts
async function ensureDedicated(opts: {
  accountId: string;
  workflowId: string;
  existing?: ProjectNeonFields;
}): Promise<NeonProvisionResult> {
  const apiKey = env.NEON_API_KEY;
  const orgId = env.NEON_ORG_ID;
  if (!apiKey || !orgId) {
    throw new Error(
      "Dedicated Neon not configured — set NEON_API_KEY and NEON_ORG_ID. Fail loud: no shared fallback.",
    );
  }

  let projectId = opts.existing?.neonProjectId ?? null;
  if (!projectId) {
    const res = await fetch("https://console.neon.tech/api/v2/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        project: {
          name: `mc-${opts.accountId.slice(0, 20)}-${opts.workflowId}`.slice(0, 63),
          org_id: orgId,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Dedicated Neon create failed: ${await res.text()}`);
    }
    const body = (await res.json()) as { project: { id: string } };
    projectId = body.project.id;
  }

  const uriRes = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?database_name=neondb&role_name=neondb_owner`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );
  if (!uriRes.ok) {
    throw new Error(`Dedicated Neon connection_uri failed: ${await uriRes.text()}`);
  }
  const uriBody = (await uriRes.json()) as { uri: string };
  assertNotControlUrl(uriBody.uri);

  return {
    neonMode: "dedicated",
    neonSchema: null,
    neonRole: null,
    neonRolePasswordEnc: null,
    neonProjectId: projectId,
    databaseUrl: uriBody.uri,
  };
}
```

In `ensureAppDatabase`:

```ts
if (plan === "free") return ensureShared(opts);
// sub | metered
return ensureDedicated(opts); // NEVER catch and call ensureShared
```

- [ ] **Step 3: Run tests**

```bash
pnpm test src/server/neon/
```

- [ ] **Step 4: Commit**

```bash
git add src/server/neon/
git commit -m "Add dedicated Neon projects for paying plans with fail-loud errors."
```

---

### Task 5: Next.js scaffold (`templateId: "next-app"`)

**Files:**
- Create: `src/server/content/scaffold-next.ts`
- Create: `src/server/content/scaffold-next.test.ts`
- Modify: `src/server/content/scaffold.ts`
- Modify: `src/server/api/routers/workflow.ts` (set `templateId: "next-app"`)

**Interfaces:**
- Produces: `scaffoldNextFromPrompt(prompt: string): ContentFile[]`
- Consumes: `ContentFile` from `store.ts`

- [ ] **Step 1: Failing test — scaffold includes build/start/railway.toml**

```ts
import { describe, expect, it } from "vitest";
import { scaffoldNextFromPrompt } from "./scaffold-next";

describe("scaffoldNextFromPrompt", () => {
  it("emits Next production scripts and railway.toml", () => {
    const files = scaffoldNextFromPrompt("hello dashboard");
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.contents]));
    expect(byPath["package.json"]).toContain('"next"');
    expect(byPath["package.json"]).toContain('"build"');
    expect(byPath["package.json"]).toContain("next start");
    expect(byPath["railway.toml"]).toMatch(/build|start/i);
    expect(byPath["app/page.tsx"]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement scaffold** — include `package.json`, `app/layout.tsx`, `app/page.tsx`, `next.config.ts`, `tsconfig.json`, `railway.toml`:

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pnpm install && pnpm build"

[deploy]
startCommand = "pnpm start"
restartPolicyType = "ON_FAILURE"
```

`package.json` scripts:

```json
{
  "dev": "next dev -H 0.0.0.0 -p ${PORT:-3000}",
  "build": "next build",
  "start": "next start -H 0.0.0.0 -p ${PORT:-3000}"
}
```

Pin reasonable Next 15 / React 19 versions matching Manycat or use `"next": "15.2.3"`.

- [ ] **Step 3: Change `scaffoldFromPrompt` to default to Next**

In `scaffold.ts`, either:
- export `scaffoldFromPrompt` that calls `scaffoldNextFromPrompt` always, and keep calculator as optional via `/^calc/` only if desired, **or**
- Spec: prompt create defaults to Next — make `scaffoldFromPrompt` → `scaffoldNextFromPrompt`, move old static scaffolds to `scaffoldStaticFromPrompt` unused by create path.

Recommended: `scaffoldFromPrompt` → Next; keep calculator static only if prompt matches AND `templateId` override — for v1 always Next.

- [ ] **Step 4: In `workflow.createFromPrompt`, set `templateId: "next-app"`** on project + change rows (replace `null`).

- [ ] **Step 5: `pnpm test` + commit**

```bash
git add src/server/content/ src/server/api/routers/workflow.ts
git commit -m "Default prompt creates to Next.js Railway-ready scaffold."
```

---

### Task 6: GitHub mirror

**Files:**
- Create: `src/server/github/mirror.ts`
- Create: `src/server/github/mirror.test.ts`

**Interfaces:**
- Produces:

```ts
export async function ensureMirroredRepo(opts: {
  accountId: string;
  workflowId: string;
  files: ContentFile[];
  existingMirrorRepo?: string | null;
}): Promise<{ mirrorGithubRepo: string }>; // "org/repo"
```

- [ ] **Step 1: Unit test with mocked fetch** — create repo when 404, put files via Contents API (or git trees API). Assert Authorization header present; assert org from env.

- [ ] **Step 2: Implement**

```ts
import { env } from "@/env";
import type { ContentFile } from "@/server/content/store";

export function mirrorRepoName(accountId: string, workflowId: string) {
  const a = accountId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
  const w = workflowId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 30);
  return `mc-${a}-${w}`.slice(0, 100);
}

export async function ensureMirroredRepo(opts: {
  accountId: string;
  workflowId: string;
  files: ContentFile[];
  existingMirrorRepo?: string | null;
}): Promise<{ mirrorGithubRepo: string }> {
  const token = env.GITHUB_MIRROR_TOKEN;
  const org = env.GITHUB_MIRROR_ORG;
  if (!token || !org) {
    throw new Error(
      "GitHub mirror not configured — set GITHUB_MIRROR_TOKEN (org-scoped) and GITHUB_MIRROR_ORG.",
    );
  }
  const name = opts.existingMirrorRepo?.split("/")[1] ?? mirrorRepoName(opts.accountId, opts.workflowId);
  const full = `${org}/${name}`;

  // 1) GET /repos/{org}/{name} — if 404, POST /orgs/{org}/repos { name, private: true, auto_init: true }
  // 2) For each file: PUT /repos/{org}/{name}/contents/{path} with base64 content + sha if updating
  // Keep implementation simple: prefer Git Data API (blobs → tree → commit → ref) for multi-file push.

  return { mirrorGithubRepo: full };
}
```

Implement multi-file push via Git Data API (create blobs, tree, commit, update `refs/heads/main`). On API failure, throw — caller aborts before Neon/Railway.

- [ ] **Step 3: Commit**

```bash
git add src/server/github/
git commit -m "Mirror virtual workspaces to Manycat GitHub org."
```

---

### Task 7: Railway client — Next + workload DATABASE_URL

**Files:**
- Modify: `src/server/railway/client.ts`
- Create: `src/server/railway/client.test.ts` (pure helper tests if you extract `assertWorkloadDatabaseUrl`)

**Interfaces:**
- Modify `createWorkloadService` / `deployProjectToRailway` to accept:

```ts
workloadEnv?: Record<string, string>; // must include DATABASE_URL when provisioned
```

- [ ] **Step 1: Add guard helper**

```ts
export function assertWorkloadDatabaseUrl(url: string) {
  if (!url) throw new Error("workload DATABASE_URL required");
  if (url === env.DATABASE_URL) {
    throw new Error("Refusing to inject control DATABASE_URL into Railway");
  }
  if (env.NEON_SHARED_DATABASE_URL && url === env.NEON_SHARED_DATABASE_URL) {
    throw new Error("Refusing to inject admin shared Neon URL into Railway");
  }
}
```

- [ ] **Step 2: Merge into service variables**

```ts
variables: {
  PORT: "3000",
  MANYCAT_ACCOUNT_ID: opts.accountId,
  MANYCAT_WORKFLOW_ID: opts.workflowId,
  MANYCAT_PLANE: "workload",
  ...opts.workloadEnv,
}
```

Before merge, if `workloadEnv.DATABASE_URL` present, call `assertWorkloadDatabaseUrl`.

On existing service redeploy, also update variables via Railway variable upsert mutation (or `variableCollectionUpsert` / equivalent GraphQL). Look up current Railway GraphQL for setting service env vars on existing services — implement `upsertServiceVariables` and call from `deployProjectToRailway` when `existingServiceId` is set.

Optional Next hints (in addition to repo `railway.toml`):

```ts
NIXPACKS_NODE_VERSION: "22",
```

- [ ] **Step 3: Unit test assert helper rejects control + admin URLs**

- [ ] **Step 4: Commit**

```bash
git add src/server/railway/
git commit -m "Inject workload-only DATABASE_URL into Railway services."
```

---

### Task 8: Wire `project.run` (mirror → Neon → Railway)

**Files:**
- Modify: `src/server/api/routers/project.ts`
- Modify: `src/server/api/routers/project.ts` list/get to return neon fields if UI needs them

**Interfaces:**
- Consumes: `ensureMirroredRepo`, `ensureAppDatabase`, `deployProjectToRailway`, `ensureAccount` / plan from budget

**Fail-loud (copy into code comments):**
> Fail loud — no silent dedicated→shared fallback. If dedicated Neon provision fails for a paying account, abort the deploy. Do not “gracefully” fall back to the shared pool.

- [ ] **Step 1: Resolve files for virtual projects**

If `project.contentBackend === "virtual"` and no user github:
- Load files from sandbox orchestrator or `.sandbox-workspaces/{workflowId}` (same paths used by createFromPrompt fallback).
- Call `ensureMirroredRepo` → `githubRepo = mirrorGithubRepo`.
- On mirror error, return `{ status: "failed", log }` **before** Neon/Railway.

If user `githubRepo` present, use it; still call Neon.

- [ ] **Step 2: Neon then Railway**

```ts
const account = await ensureAccount(ctx.accountId);
const neon = await ensureAppDatabase({
  accountId: ctx.accountId,
  workflowId: input.workflowId,
  plan: account.billingPlan,
  existing: project ?? undefined,
});
// if this throws for dedicated — do not catch and switch to shared

const result = await deployProjectToRailway({
  config,
  accountId: ctx.accountId,
  workflowId: input.workflowId,
  githubRepo, // user or mirror
  existingServiceId: project?.railwayServiceId,
  workloadEnv: { DATABASE_URL: neon.databaseUrl },
});

await db.update(projects).set({
  mirrorGithubRepo: mirrorRepo ?? project?.mirrorGithubRepo,
  neonMode: neon.neonMode,
  neonSchema: neon.neonSchema,
  neonRole: neon.neonRole,
  neonRolePasswordEnc: neon.neonRolePasswordEnc,
  neonProjectId: neon.neonProjectId,
  railwayServiceId: result.serviceId,
  railwayDomain: result.url ?? project?.railwayDomain,
  githubRepo: project?.githubRepo ?? (userRepo ? githubRepo : project?.githubRepo),
}).where(...);
```

Never persist `neon.databaseUrl` for dedicated. Shared may persist encrypted role password only.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/server/api/routers/project.ts
git commit -m "Wire Railway run through mirror, Neon provision, and safe DB inject."
```

---

### Task 9: Deployments UI — virtual Run + neon badge

**Files:**
- Modify: `src/app/_fragments/chat/deployments-panel.tsx`
- Modify: `src/server/api/routers/project.ts` `list` select to include `neonMode`, `mirrorGithubRepo`, `contentBackend`

- [ ] **Step 1: Enable Run without `owner/repo` user repo**

```ts
const canRun = Boolean(
  p.githubRepo?.includes("/") ||
    p.mirrorGithubRepo?.includes("/") ||
    p.contentBackend === "virtual",
);
// onClick: pass githubRepo only if user repo; else omit and let server mirror
runConfig: { kind: "railway", railway: repo ? { githubRepo: repo } : undefined }
```

Update `runConfigInput` zod if `railway.githubRepo` is required — make optional.

- [ ] **Step 2: Show badge**

```tsx
{p.neonMode === "shared" ? (
  <span className="text-muted-foreground text-xs">Shared schema · upgrade for dedicated DB</span>
) : p.neonMode === "dedicated" ? (
  <span className="text-muted-foreground text-xs">Dedicated Neon</span>
) : null}
```

- [ ] **Step 3: Empty-state copy** — “Import or create from prompt, then Run on Railway.”

- [ ] **Step 4: Commit**

```bash
git add src/app/_fragments/chat/deployments-panel.tsx src/server/api/routers/project.ts
git commit -m "Allow Railway run for virtual projects and show Neon mode."
```

---

### Task 10: Docs + verification checklist

**Files:**
- Modify: `docs/planes.md` (one paragraph: shared Neon admin URL control-only; workload gets role URL)
- Modify: design status line to `Implemented (see plans/…)` when done — optional

- [ ] **Step 1: Document plane rule for Neon admin URL in `docs/planes.md`**

- [ ] **Step 2: Manual checklist (run locally)**

1. Free account: create from prompt → Run on Railway → service gets role `DATABASE_URL` ≠ admin.
2. `pnpm test` isolation suite against shared Neon.
3. Paying (`billingPlan=sub` in DB): Run → new Neon project; kill API key → Run fails with dedicated error, **no** shared schema created for that workflow.
4. Confirm control `DATABASE_URL` never appears in Railway service variables (Railway dashboard).

- [ ] **Step 3: Commit**

```bash
git add docs/planes.md
git commit -m "Document Neon admin vs workload role URL plane boundary."
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Next template + railway.toml | 5 |
| GitHub mirror org | 6 |
| Railway Next + DB inject | 7–8 |
| Free schema+role isolation | 3 |
| One-time public REVOKE | 3 (`shared-setup`) |
| App-owned table test | 3 isolation test |
| Cross-schema deny test | 3 |
| Dedicated on-demand URI | 4 |
| Fail loud no shared fallback | 4, 8 (Global Constraints) |
| Org-scoped mirror token docs | 1, 6 |
| No dedicated URL at rest | 4, 8 |
| Control metadata Neon | existing + 1 columns |
| Deployments UX | 9 |
| Env example | 1 |

**Placeholder scan:** none intentional. Dedicated GraphQL variable upsert mutation name must be verified against Railway API during Task 7 — if the exact mutation differs, use Railway’s current `variableUpsert` / collection API without changing the security guards.

**Type consistency:** `NeonProvisionResult` and `ensureAppDatabase` signatures are defined in Task 3 and reused in 4/8.
