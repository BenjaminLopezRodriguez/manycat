"""
Deterministic scaffold replacement when the model describes UI but never
successfully calls write_file (common with small local/vLLM coder models).
"""

from __future__ import annotations

import json
import re
from pathlib import Path


def extract_user_request(prompt: str) -> str:
    """Prefer the last 'User request:' section (handles double-wrapped prompts)."""
    parts = re.split(r"(?i)user request:\s*", prompt)
    if len(parts) > 1:
        return parts[-1].strip()
    return prompt.strip()


def build_fallback_page(user_request: str) -> str:
    """Return a complete app/page.tsx implementing a reasonable UI for the ask."""
    req = user_request.strip() or "App"
    lowered = req.lower()
    title = req[:72].rstrip(".") if len(req) <= 72 else req[:69].rstrip() + "…"
    title_lit = json.dumps(title)

    wants_pink = "pink" in lowered
    wants_blue = "blue" in lowered
    is_calc = any(w in lowered for w in ("calculator", "calc", "math"))
    is_waitlist = any(
        w in lowered for w in ("waitlist", "landing", "signup", "sign up")
    )

    bg = "#ffe4f1" if wants_pink else "#f4f7fb"
    accent = "#ff4da6" if wants_pink else "#2563eb"
    btn = "#3b82f6" if wants_blue else accent

    if is_calc:
        return f'''"use client";

import {{ useState }} from "react";

const TITLE = {title_lit};
const BTNS = [
  ["C", "±", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "="],
] as const;

function isOp(key: string) {{
  return key === "+" || key === "−" || key === "×" || key === "÷" || key === "C" || key === "±" || key === "%";
}}

export default function HomePage() {{
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);

  function apply(a: number, b: number, operator: string) {{
    switch (operator) {{
      case "+":
        return a + b;
      case "−":
        return a - b;
      case "×":
        return a * b;
      case "÷":
        return b === 0 ? NaN : a / b;
      default:
        return b;
    }}
  }}

  function onPress(key: string) {{
    if (key === "C") {{
      setDisplay("0");
      setStored(null);
      setOp(null);
      setFresh(true);
      return;
    }}
    if (key === "±") {{
      setDisplay((d) => (d.startsWith("-") ? d.slice(1) : d === "0" ? d : `-${{d}}`));
      return;
    }}
    if (key === "%") {{
      setDisplay((d) => String(Number(d) / 100));
      setFresh(true);
      return;
    }}
    if (key === "+" || key === "−" || key === "×" || key === "÷") {{
      const n = Number(display);
      if (stored != null && op && !fresh) {{
        const result = apply(stored, n, op);
        setStored(result);
        setDisplay(String(result));
      }} else {{
        setStored(n);
      }}
      setOp(key);
      setFresh(true);
      return;
    }}
    if (key === "=") {{
      if (stored == null || !op) return;
      const result = apply(stored, Number(display), op);
      setDisplay(Number.isFinite(result) ? String(result) : "Error");
      setStored(null);
      setOp(null);
      setFresh(true);
      return;
    }}
    if (key === ".") {{
      if (fresh) {{
        setDisplay("0.");
        setFresh(false);
        return;
      }}
      if (!display.includes(".")) setDisplay(display + ".");
      return;
    }}
    setDisplay((d) => (fresh || d === "0" ? key : d + key));
    setFresh(false);
  }}

  return (
    <main
      style={{{{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "{bg}",
        fontFamily: "ui-rounded, system-ui, sans-serif",
      }}}}
    >
      <div
        style={{{{
          width: "min(100%, 320px)",
          borderRadius: 28,
          padding: 20,
          background: "{accent}",
          boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
        }}}}
      >
        <h1 style={{{{ margin: "0 0 12px", color: "#fff", fontSize: 18, fontWeight: 700 }}}}>
          {{TITLE}}
        </h1>
        <div
          style={{{{
            background: "#111827",
            color: "#fff",
            borderRadius: 16,
            padding: "16px 18px",
            textAlign: "right",
            fontSize: 36,
            fontVariantNumeric: "tabular-nums",
            marginBottom: 14,
            minHeight: 64,
            overflow: "hidden",
          }}}}
        >
          {{display}}
        </div>
        <div style={{{{ display: "grid", gap: 10 }}}}>
          {{BTNS.map((row, i) => (
            <div
              key={{i}}
              style={{{{
                display: "grid",
                gridTemplateColumns: row.length === 3 ? "2fr 1fr 1fr" : "repeat(4, 1fr)",
                gap: 10,
              }}}}
            >
              {{row.map((key) => (
                <button
                  key={{key}}
                  type="button"
                  onClick={{() => onPress(key)}}
                  style={{{{
                    border: "none",
                    borderRadius: 14,
                    padding: "16px 0",
                    fontSize: 20,
                    fontWeight: 600,
                    cursor: "pointer",
                    background:
                      key === "="
                        ? "#111827"
                        : isOp(key)
                          ? "rgba(255,255,255,0.28)"
                          : "{btn}",
                    color: "#fff",
                  }}}}
                >
                  {{key}}
                </button>
              ))}}
            </div>
          ))}}
        </div>
      </div>
    </main>
  );
}}
'''

    if is_waitlist:
        return f'''"use client";

import {{ FormEvent, useState }} from "react";

const TITLE = {title_lit};

export default function HomePage() {{
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);

  function onSubmit(e: FormEvent) {{
    e.preventDefault();
    if (!email.includes("@")) return;
    setJoined(true);
  }}

  return (
    <main
      style={{{{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "radial-gradient(circle at top, {bg}, #ffffff 55%)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}}}
    >
      <section style={{{{ maxWidth: 520, textAlign: "center" }}}}>
        <p
          style={{{{
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "{accent}",
            fontSize: 12,
            fontFamily: "system-ui, sans-serif",
          }}}}
        >
          Early access
        </p>
        <h1 style={{{{ fontSize: "clamp(2rem, 5vw, 3rem)", margin: "0.4rem 0 0.75rem", lineHeight: 1.1 }}}}>
          {{TITLE}}
        </h1>
        <p style={{{{ color: "#4b5563", fontSize: 18, marginBottom: "1.75rem", fontFamily: "system-ui, sans-serif" }}}}>
          Join the waitlist and we&apos;ll ping you when it&apos;s ready.
        </p>
        {{joined ? (
          <p style={{{{ color: "{accent}", fontWeight: 600, fontFamily: "system-ui, sans-serif" }}}}>
            You&apos;re on the list — talk soon.
          </p>
        ) : (
          <form
            onSubmit={{onSubmit}}
            style={{{{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "center",
              fontFamily: "system-ui, sans-serif",
            }}}}
          >
            <input
              type="email"
              required
              value={{email}}
              onChange={{(e) => setEmail(e.target.value)}}
              placeholder="you@company.com"
              style={{{{
                flex: "1 1 220px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                padding: "12px 16px",
                fontSize: 16,
              }}}}
            />
            <button
              type="submit"
              style={{{{
                border: "none",
                borderRadius: 999,
                padding: "12px 20px",
                background: "{btn}",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}}}
            >
              Join waitlist
            </button>
          </form>
        )}}
      </section>
    </main>
  );
}}
'''

    return f'''"use client";

import {{ useState }} from "react";

const TITLE = {title_lit};

export default function HomePage() {{
  const [count, setCount] = useState(0);

  return (
    <main
      style={{{{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "{bg}",
        fontFamily: "system-ui, sans-serif",
      }}}}
    >
      <section
        style={{{{
          maxWidth: 480,
          width: "100%",
          borderRadius: 24,
          padding: "2rem",
          background: "#fff",
          boxShadow: "0 16px 40px rgba(0,0,0,0.08)",
          textAlign: "center",
        }}}}
      >
        <h1 style={{{{ margin: "0 0 0.75rem", fontSize: "1.75rem", color: "{accent}" }}}}>
          {{TITLE}}
        </h1>
        <p style={{{{ color: "#4b5563", marginBottom: "1.5rem" }}}}>
          Interactive starter UI generated for your request.
        </p>
        <button
          type="button"
          onClick={{() => setCount((c) => c + 1)}}
          style={{{{
            border: "none",
            borderRadius: 12,
            padding: "12px 18px",
            background: "{btn}",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: 16,
          }}}}
        >
          Clicked {{count}} times
        </button>
      </section>
    </main>
  );
}}
'''


def apply_scaffold_fallback(workspace: Path, prompt: str) -> str:
    """Write app/page.tsx fallback. Returns a short note for the agent reply."""
    request = extract_user_request(prompt)
    content = build_fallback_page(request)
    page = workspace / "app" / "page.tsx"
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text(content, encoding="utf-8")
    return (
        "Applied a deterministic UI fallback for app/page.tsx because the model "
        "did not successfully edit files. Refresh preview to see the working UI."
    )
