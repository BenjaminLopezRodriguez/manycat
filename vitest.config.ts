import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Allow importing @/env in unit tests without a full local .env
    env: { SKIP_ENV_VALIDATION: "1" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
