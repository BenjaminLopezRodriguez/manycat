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
