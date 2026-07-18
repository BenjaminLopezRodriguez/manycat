export function BasisBrowserMock() {
  return (
    <div className="relative mx-auto w-full" aria-hidden>
      <div
        className="absolute -inset-x-6 -inset-y-4 rounded-[2rem] opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 40%, rgba(26,25,23,0.08), transparent)",
        }}
      />

      <div
        className="relative overflow-hidden rounded-2xl border shadow-[0_1px_0_rgba(26,25,23,0.04),0_20px_50px_rgba(26,25,23,0.08)]"
        style={{
          background: "#fffcf8",
          borderColor: "rgba(26,25,23,0.08)",
        }}
      >
        {/* title bar */}
        <div
          className="flex items-center gap-3 px-3.5 py-2.5"
          style={{ borderBottom: "1px solid rgba(26,25,23,0.06)" }}
        >
          <div className="flex gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: "#e4ddd4" }}
            />
            <span
              className="size-2.5 rounded-full"
              style={{ background: "#e4ddd4" }}
            />
            <span
              className="size-2.5 rounded-full"
              style={{ background: "#e4ddd4" }}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Tab active label="Workspace" />
            <Tab label="Brief" />
          </div>
        </div>

        {/* toolbar */}
        <div
          className="flex items-center gap-2 px-3.5 py-2"
          style={{ borderBottom: "1px solid rgba(26,25,23,0.06)" }}
        >
          <NavGlyph />
          <NavGlyph flip />
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-1.5"
            style={{ background: "rgba(26,25,23,0.04)" }}
          >
            <LockDot />
            <span
              className="truncate text-[11px]"
              style={{ color: "rgba(26,25,23,0.45)", fontFamily: "ui-sans-serif, system-ui" }}
            >
              docs.manycat.dev/agents/workspace
            </span>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] tracking-[0.04em]"
            style={{
              background: "rgba(26,25,23,0.06)",
              color: "rgba(26,25,23,0.55)",
            }}
          >
            Agent
          </span>
        </div>

        {/* body */}
        <div className="grid grid-cols-[1fr_10.5rem] sm:grid-cols-[1fr_12.5rem]">
          <div className="space-y-3.5 p-5" style={{ background: "#fffcf8" }}>
            <div
              className="h-2 w-16 rounded-full"
              style={{ background: "rgba(26,25,23,0.08)" }}
            />
            <div
              className="h-3.5 w-[70%] max-w-[15rem] rounded-full"
              style={{ background: "rgba(26,25,23,0.14)" }}
            />
            <div className="space-y-2 pt-1">
              <Line w="100%" />
              <Line w="94%" />
              <Line w="82%" />
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <QuietBlock />
              <QuietBlock />
            </div>
            <div className="space-y-2 pt-1">
              <Line w="100%" />
              <Line w="88%" />
              <Line w="60%" />
            </div>
          </div>

          <aside
            className="p-3.5"
            style={{
              borderLeft: "1px solid rgba(26,25,23,0.06)",
              background: "#f3efe8",
            }}
          >
            <p
              className="mb-2.5 text-[10px] tracking-[0.06em]"
              style={{ color: "rgba(26,25,23,0.35)" }}
            >
              Session
            </p>
            <div
              className="mb-3 rounded-xl p-2.5"
              style={{ background: "rgba(26,25,23,0.04)" }}
            >
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: "rgba(26,25,23,0.65)" }}
              >
                Summarize this page into a short deploy checklist.
              </p>
            </div>
            <div className="space-y-1.5">
              <ToolRow name="Read page" state="done" />
              <ToolRow name="Extract links" state="done" />
              <ToolRow name="Draft checklist" state="live" />
            </div>
            <div className="mt-4 space-y-1.5">
              <Line w="100%" />
              <Line w="78%" />
              <div
                className="h-1.5 rounded-full"
                style={{
                  width: "48%",
                  background: "rgba(26,25,23,0.22)",
                }}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Tab({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      className="truncate rounded-full px-2.5 py-1 text-[11px]"
      style={{
        background: active ? "rgba(26,25,23,0.06)" : "transparent",
        color: active ? "rgba(26,25,23,0.75)" : "rgba(26,25,23,0.35)",
      }}
    >
      {label}
    </span>
  );
}

function NavGlyph({ flip }: { flip?: boolean }) {
  return (
    <span
      className={`flex size-6 items-center justify-center ${flip ? "scale-x-[-1]" : ""}`}
      style={{ color: "rgba(26,25,23,0.28)" }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M6.5 1.5L3 5l3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function LockDot() {
  return (
    <span
      className="flex size-3.5 items-center justify-center"
      style={{ color: "rgba(26,25,23,0.3)" }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <rect
          x="2"
          y="4.5"
          width="6"
          height="4"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.15"
        />
        <path
          d="M3.5 4.5V3.2a1.5 1.5 0 013 0v1.3"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function Line({ w }: { w: string }) {
  return (
    <div
      className="h-1.5 rounded-full"
      style={{ width: w, background: "rgba(26,25,23,0.07)" }}
    />
  );
}

function QuietBlock() {
  return (
    <div
      className="h-14 rounded-xl"
      style={{
        background: "rgba(26,25,23,0.03)",
        border: "1px solid rgba(26,25,23,0.05)",
      }}
    />
  );
}

function ToolRow({
  name,
  state,
}: {
  name: string;
  state: "done" | "live";
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2 py-1.5"
      style={{ background: "rgba(26,25,23,0.03)" }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{
          background:
            state === "live"
              ? "rgba(26,25,23,0.55)"
              : "rgba(26,25,23,0.2)",
        }}
      />
      <span
        className="truncate text-[10px]"
        style={{ color: "rgba(26,25,23,0.5)" }}
      >
        {name}
      </span>
    </div>
  );
}
