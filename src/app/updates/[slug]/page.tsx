import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getUpdate,
  listUpdatesByKind,
  type UpdatePromo,
} from "@/content/updates";

export function generateStaticParams() {
  return listUpdatesByKind("blog").map((u) => ({ slug: u.slug }));
}

export default async function UpdatePostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const update = getUpdate(slug);
  if (update?.kind !== "blog") notFound();

  return <BlogView update={update} />;
}

function BlogView({ update }: { update: UpdatePromo }) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Manycat
        </Link>
      </header>
      <article className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-16">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          {update.eyebrow} · {update.publishedAt}
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {update.title}
        </h1>
        <p className="text-muted-foreground text-lg leading-relaxed">
          {update.blurb}
        </p>
        <div className="text-foreground/90 space-y-4 text-base leading-relaxed">
          <p>{update.body}</p>
        </div>
      </article>
    </div>
  );
}
