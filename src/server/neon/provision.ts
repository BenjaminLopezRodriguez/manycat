import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { env } from "@/env";
import type { BillingPlan } from "@/server/billing/budget";
import { decryptSecret, encryptSecret } from "./crypto";
import { roleNameFor, schemaNameFor } from "./names";
import { ensureSharedDbHardened } from "./shared-setup";

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

export { ensureSharedDbHardened };

/** Always derive schema/role from workflowId — never trust stored names for DDL. */
export function resolveSharedNames(workflowId: string) {
  return {
    schema: schemaNameFor(workflowId),
    role: roleNameFor(workflowId),
  };
}

function assertNotControlUrl(url: string) {
  if (url === env.DATABASE_URL) {
    throw new Error("Refusing to use control DATABASE_URL as workload DB");
  }
  if (url === env.NEON_SHARED_DATABASE_URL) {
    throw new Error(
      "Refusing to inject admin NEON_SHARED_DATABASE_URL into workload",
    );
  }
}

function buildRoleUrl(
  adminUrl: string,
  role: string,
  password: string,
  schema: string,
) {
  const u = new URL(adminUrl);
  u.username = role;
  u.password = password;
  u.searchParams.set("options", `-csearch_path=${schema}`);
  return u.toString();
}

function quoteIdent(id: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(id)) throw new Error(`Unsafe ident: ${id}`);
  return `"${id}"`;
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

  // Force derived names before any DDL — do not trust opts.existing schema/role.
  const { schema, role } = resolveSharedNames(opts.workflowId);
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
    await sql.unsafe(
      `GRANT USAGE, CREATE ON SCHEMA ${quoteIdent(schema)} TO ${quoteIdent(role)}`,
    );
    await sql.unsafe(
      `ALTER ROLE ${quoteIdent(role)} SET search_path TO ${quoteIdent(schema)}`,
    );
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

/**
 * Fail loud — no silent dedicated→shared fallback.
 * Creates (or reuses) a dedicated Neon project and fetches connection_uri on demand.
 * Never persist dedicated URIs — callers inject databaseUrl ephemerally only.
 */
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
          name: `mc-${opts.accountId.slice(0, 20)}-${opts.workflowId}`.slice(
            0,
            63,
          ),
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
    throw new Error(
      `Dedicated Neon connection_uri failed: ${await uriRes.text()}`,
    );
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

export async function ensureAppDatabase(opts: {
  accountId: string;
  workflowId: string;
  plan: BillingPlan;
  existing?: ProjectNeonFields;
}): Promise<NeonProvisionResult> {
  if (opts.plan === "free") {
    return ensureShared({
      workflowId: opts.workflowId,
      existing: opts.existing,
    });
  }
  // Fail loud — no silent dedicated→shared fallback.
  // NEVER catch and call ensureShared
  return ensureDedicated({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    existing: opts.existing,
  });
}
