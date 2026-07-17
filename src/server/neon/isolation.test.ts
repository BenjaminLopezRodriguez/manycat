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
    if (!adminUrl) return;
    const sql = postgres(adminUrl, { max: 1 });
    try {
      const { roleNameFor, schemaNameFor } = await import("./names");
      for (const wf of [wfA, wfB]) {
        const schema = schemaNameFor(wf);
        const role = roleNameFor(wf);
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await sql.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      }
    } catch {
      // best-effort cleanup via admin
    } finally {
      await sql.end();
    }
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

describe("ensureAppDatabase fail-loud dedicated", () => {
  it("throws for paying plans and does not fall back to shared", async () => {
    const { ensureAppDatabase } = await import("./provision");
    // Without NEON_API_KEY / NEON_ORG_ID — fail loud, never shared
    await expect(
      ensureAppDatabase({
        accountId: "acct",
        workflowId: "wf_pay",
        plan: "sub",
      }),
    ).rejects.toThrow(/Dedicated Neon not configured|fail loud|no shared fallback/i);
    await expect(
      ensureAppDatabase({
        accountId: "acct",
        workflowId: "wf_pay2",
        plan: "metered",
      }),
    ).rejects.toThrow(/Dedicated Neon not configured|fail loud|no shared fallback/i);
  });
});
