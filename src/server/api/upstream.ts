/** Never dump HTML/Next 404 pages into chat. */
export function summarizeUpstreamBody(
  body: string,
  status: number,
  label = "Upstream",
): string {
  const trimmed = body.trim();
  if (!trimmed) return `${label} returned HTTP ${status} with empty body.`;
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    /<title>404: This page could not be found\.<\/title>/i.test(trimmed)
  ) {
    return (
      `${label} returned HTTP ${status} (HTML error page, not the agent API). ` +
      `AGENT_HARNESS_URL is wrong or the harness service is serving the wrong app.`
    );
  }
  if (trimmed.length > 400) {
    return `${label} returned HTTP ${status}: ${trimmed.slice(0, 400)}…`;
  }
  return `${label} returned HTTP ${status}: ${trimmed}`;
}
