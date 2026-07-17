/** First-turn prompt: generate product UI on the existing Next scaffold. */
export function wrapNextScaffoldBootstrapPrompt(userPrompt: string): string {
  const prompt = userPrompt.trim();
  return [
    "You are editing an existing Next.js App Router project already in the workspace.",
    "Keep the App Router layout (`app/`), TypeScript, and package.json scripts that build and run with `next start` on `$PORT` (Railway-ready).",
    "Implement the user's product request on top of this scaffold: add/edit pages, components, styles, and dependencies as needed.",
    "Do not replace the project with a non-Next stack unless the user explicitly asks.",
    "Use tools to edit files; then briefly summarize what you built.",
    "",
    "User request:",
    prompt,
  ].join("\n");
}
