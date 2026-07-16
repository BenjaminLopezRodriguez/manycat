/** Read a resolved CSS custom property as a hex color for Monaco. */
import type * as Monaco from "monaco-editor";

function cssVarToHex(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;

  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${name})`;
  document.documentElement.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  const rgbPattern = /rgba?\((\d+),\s*(\d+),\s*(\d+)/;
  const match = rgbPattern.exec(resolved);
  if (!match) return fallback;

  const [, r, g, b] = match;
  return (
    "#" +
    [r, g, b]
      .map((v) => Number(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

function withAlpha(hex: string, alphaHex: string) {
  return `${hex}${alphaHex}`;
}

export function buildMonacoTheme(monaco: typeof Monaco) {
  const bg = cssVarToHex("--code-background", "#00123d");
  const fg = cssVarToHex("--code-foreground", "#e8f0ff");
  const accent = cssVarToHex("--code-accent", "#4cff7c");
  const muted = cssVarToHex("--code-muted", "#7a8bb5");
  const keyword = cssVarToHex("--code-keyword", "#7eb6ff");
  const del = cssVarToHex("--code-del", "#ff4c6a");
  const gutter = cssVarToHex("--code-gutter", "#4a5f8a");
  const selection = cssVarToHex("--code-selection", "#001d7d");

  monaco.editor.defineTheme("manycat", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: muted.slice(1), fontStyle: "italic" },
      { token: "string", foreground: accent.slice(1) },
      { token: "keyword", foreground: keyword.slice(1) },
      { token: "number", foreground: accent.slice(1) },
    ],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorLineNumber.foreground": gutter,
      "editorLineNumber.activeForeground": accent,
      "editor.selectionBackground": withAlpha(selection, "88"),
      "editor.lineHighlightBackground": withAlpha(selection, "44"),
      "editorCursor.foreground": accent,
      "diffEditor.insertedTextBackground": withAlpha(accent, "22"),
      "diffEditor.removedTextBackground": withAlpha(del, "22"),
      "editorGutter.background": bg,
    },
  });
}

export const MANYCAT_EDITOR_THEME = "manycat";
