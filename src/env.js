import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    AGENT_HARNESS_URL: z.string().url().optional(),
    SANDBOX_ORCHESTRATOR_URL: z.string().url().optional(),
    // TODO: single-user v1 — this token deploys under one Vercel account for everyone.
    // Per-project tokens are required before multi-user.
    VERCEL_TOKEN: z.string().optional(),
    /**
     * Railway — server-only. Used to create user preview services in the
     * WORKLOAD project (never the control-plane project).
     */
    RAILWAY_API_TOKEN: z.string().min(1).optional(),
    RAILWAY_WORKLOAD_PROJECT_ID: z.string().min(1).optional(),
    RAILWAY_WORKLOAD_ENVIRONMENT_ID: z.string().min(1).optional(),
    /** Optional docs/ops id for control-plane project (orchestrator/agent). */
    RAILWAY_CONTROL_PROJECT_ID: z.string().min(1).optional(),
    AUTH_SECRET: z.string().min(1).optional(),
    AUTH_URL: z.string().url().optional(),
    AUTH_GITHUB_ID: z.string().min(1).optional(),
    AUTH_GITHUB_SECRET: z.string().min(1).optional(),
    AUTH_GOOGLE_ID: z.string().min(1).optional(),
    AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_SANDBOX_ENABLED: z.string().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    AGENT_HARNESS_URL: process.env.AGENT_HARNESS_URL,
    SANDBOX_ORCHESTRATOR_URL: process.env.SANDBOX_ORCHESTRATOR_URL,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    RAILWAY_API_TOKEN: process.env.RAILWAY_API_TOKEN,
    RAILWAY_WORKLOAD_PROJECT_ID: process.env.RAILWAY_WORKLOAD_PROJECT_ID,
    RAILWAY_WORKLOAD_ENVIRONMENT_ID:
      process.env.RAILWAY_WORKLOAD_ENVIRONMENT_ID,
    RAILWAY_CONTROL_PROJECT_ID: process.env.RAILWAY_CONTROL_PROJECT_ID,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    NEXT_PUBLIC_SANDBOX_ENABLED: process.env.NEXT_PUBLIC_SANDBOX_ENABLED,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
