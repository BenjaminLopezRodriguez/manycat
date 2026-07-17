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
