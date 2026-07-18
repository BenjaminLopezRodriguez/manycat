/** First-turn prompt: generate product UI on the existing Next scaffold. */
export function wrapNextScaffoldBootstrapPrompt(userPrompt: string): string {
  const prompt = userPrompt.trim();
  return [
    "You are editing an existing Next.js App Router project already in the workspace.",
    "Keep the App Router layout (`app/`), TypeScript, and package.json scripts that build and run with `next start` on `$PORT` (Railway-ready).",
    "Implement the user's product request on top of this scaffold: add/edit pages, components, styles, and dependencies as needed.",
    "Do not replace the project with a non-Next stack unless the user explicitly asks.",
    "Use write_file / edit_file tools to change files — never paste JSON tool stubs in chat.",
    "Replace the scaffold homepage (remove 'Scaffolded by Manycat') with a real working UI for the request.",
    "Then briefly summarize what you built.",
    "",
    "User request:",
    prompt,
  ].join("\n");
}
