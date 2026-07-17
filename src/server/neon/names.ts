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
