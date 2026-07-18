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
    // Used by src/server/ai/structure-prompt.ts to expand raw prompts before
    // handing off to the agent-harness codegen model. Not the same key as
    // agent-harness's own OPENAI_API_KEY (Modal routing) — same value works
    // for both, but this one only needs to be real for the structuring call.
    OPENAI_API_KEY: z.string().min(1).optional(),
    // Modal-hosted open-weight models, called directly (no coding tool loop
    // needed) — research/workspace share MODAL_CHAT_URL, create uses
    // MODAL_IMAGE_URL. See infra/modal/serve_chat.py / serve_image.py.
    MODAL_CHAT_URL: z.string().url().optional(),
    MODAL_IMAGE_URL: z.string().url().optional(),
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
    GITHUB_MIRROR_TOKEN: z.string().min(1).optional(),
    GITHUB_MIRROR_ORG: z.string().min(1).optional(),
    NEON_API_KEY: z.string().min(1).optional(),
    NEON_ORG_ID: z.string().min(1).optional(),
    NEON_SHARED_PROJECT_ID: z.string().min(1).optional(),
    NEON_SHARED_DATABASE_URL: z.string().url().optional(),
    APP_DB_ENCRYPTION_KEY: z.string().min(32).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_FROM: z.string().min(1).optional(),
    INTEGRATION_REQUEST_TO: z.string().email().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_SANDBOX_ENABLED: z.string().optional(),
    NEXT_PUBLIC_ENABLED_MODES: z.string().optional(),
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
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MODAL_CHAT_URL: process.env.MODAL_CHAT_URL,
    MODAL_IMAGE_URL: process.env.MODAL_IMAGE_URL,
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
    GITHUB_MIRROR_TOKEN: process.env.GITHUB_MIRROR_TOKEN,
    GITHUB_MIRROR_ORG: process.env.GITHUB_MIRROR_ORG,
    NEON_API_KEY: process.env.NEON_API_KEY,
    NEON_ORG_ID: process.env.NEON_ORG_ID,
    NEON_SHARED_PROJECT_ID: process.env.NEON_SHARED_PROJECT_ID,
    NEON_SHARED_DATABASE_URL: process.env.NEON_SHARED_DATABASE_URL,
    APP_DB_ENCRYPTION_KEY: process.env.APP_DB_ENCRYPTION_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    INTEGRATION_REQUEST_TO: process.env.INTEGRATION_REQUEST_TO,
    NEXT_PUBLIC_SANDBOX_ENABLED: process.env.NEXT_PUBLIC_SANDBOX_ENABLED,
    NEXT_PUBLIC_ENABLED_MODES: process.env.NEXT_PUBLIC_ENABLED_MODES,
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
