import { describe, expect, it } from "vitest";
import { roleNameFor, schemaNameFor } from "./names";
import { resolveSharedNames } from "./provision";

describe("resolveSharedNames", () => {
  it("ignores mismatched existing schema/role and derives from workflowId only", () => {
    const workflowId = "wf_secure_1";
    const derived = resolveSharedNames(workflowId);

    // Simulate poisoned/stale existing fields — must not affect resolution
    const existing = {
      neonSchema: "evil_other_schema",
      neonRole: "evil_other_role",
    };

    expect(derived.schema).toBe(schemaNameFor(workflowId));
    expect(derived.role).toBe(roleNameFor(workflowId));
    expect(derived.schema).not.toBe(existing.neonSchema);
    expect(derived.role).not.toBe(existing.neonRole);
    // Helper takes workflowId only — no path to pass existing names
    expect(resolveSharedNames.length).toBe(1);
  });
});
