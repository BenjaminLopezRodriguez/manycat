import Link from "next/link";
import { Newsreader } from "next/font/google";
import { notFound } from "next/navigation";

import {
  getUpdate,
  listUpdatesByKind,
  type UpdatePromo,
} from "@/content/updates";
import { cn } from "@/lib/utils";

import { BasisBrowserMock } from "./basis-browser-mock";

const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});

export function generateStaticParams() {
  return listUpdatesByKind("download").map((u) => ({ slug: u.slug }));
}

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const update = getUpdate(slug);
  if (update?.kind !== "download") notFound();

  return <DownloadView update={update} />;
}

function DownloadView({ update }: { update: UpdatePromo }) {
  const isBasis = update.slug === "basis";

  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{ background: "#f7f4ef", color: "#1a1917" }}
    >
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 md:px-10">
        <Link
          href="/"
          className="text-[13px] text-[#1a1917]/45 transition-colors hover:text-[#1a1917]/80"
        >
          Manycat
        </Link>
        <span
          className={cn(
            display.className,
            "text-[15px] tracking-[-0.01em] text-[#1a1917]/70",
          )}
        >
          {update.title}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-14 px-6 py-10 md:gap-16 md:px-10 md:py-16">
        <section className="mx-auto max-w-xl text-center">
          <p className="mb-5 text-[12px] tracking-[0.08em] text-[#1a1917]/40">
            Research preview
          </p>
          <h1
            className={cn(
              display.className,
              "text-[2.75rem] leading-[1.1] tracking-[-0.02em] text-[#1a1917] md:text-[3.5rem]",
            )}
          >
            {update.title}
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[16px] leading-[1.65] text-[#1a1917]/55">
            {isBasis
              ? "A browser for working with agents. Context stays with the page. Tools stay in reach. Built to feel calm while you think."
              : update.body}
          </p>

          <div className="mt-9 flex flex-col items-center gap-3">
            {update.downloadUrl ? (
              <a
                href={update.downloadUrl}
                download
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#1a1917] px-7 text-[14px] font-medium text-[#f7f4ef] transition-opacity hover:opacity-85"
              >
                Download for macOS
              </a>
            ) : null}
            <p className="text-[12px] tracking-wide text-[#1a1917]/35">
              Version 0.9.2 · 148 MB · macOS 13 or later
            </p>
          </div>
        </section>

        {isBasis ? (
          <section className="mx-auto w-full max-w-3xl">
            <BasisBrowserMock />
          </section>
        ) : null}

        <section className="mx-auto grid w-full max-w-2xl gap-8 border-t border-[#1a1917]/08 pt-10 text-left sm:grid-cols-3 sm:gap-6">
          <QuietPoint
            title="Persistent context"
            body="Agents remember the page you’re on — across tabs, reloads, and revisits."
          />
          <QuietPoint
            title="Native tools"
            body="Read, extract, and act without leaving the site or pasting into another window."
          />
          <QuietPoint
            title="URL workspaces"
            body="Pin a session to a place on the web. Return later; the work is still there."
          />
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-[12px] text-[#1a1917]/30 md:px-10">
        <span>Released {update.publishedAt}</span>
        <span>Available through Manycat</span>
      </footer>
    </div>
  );
}

function QuietPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2">
      <h2
        className={cn(
          display.className,
          "text-[17px] tracking-[-0.01em] text-[#1a1917]/85",
        )}
      >
        {title}
      </h2>
      <p className="text-[13px] leading-relaxed text-[#1a1917]/45">{body}</p>
    </div>
  );
}
