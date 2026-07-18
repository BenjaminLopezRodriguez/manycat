export type UpdateKind = "blog" | "download";

export type UpdatePromo = {
  slug: string;
  kind: UpdateKind;
  eyebrow: string;
  title: string;
  blurb: string;
  /** Longer body for the destination page */
  body: string;
  /** For download kind — asset path or external package URL */
  downloadUrl?: string;
  publishedAt: string;
  featured?: boolean;
};

const UPDATES: UpdatePromo[] = [
  {
    slug: "basis",
    kind: "download",
    eyebrow: "New",
    title: "Basis",
    blurb: "A new browser built for agent-native work.",
    body: "Basis is a browser built around agents — persistent context, native tool calls, and workspaces that stay with the page. Download the desktop build and try it alongside Manycat.",
    downloadUrl: "/downloads/basis.dmg",
    publishedAt: "2026-07-17",
    featured: true,
  },
];

export function listUpdates(): UpdatePromo[] {
  return [...UPDATES].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
}

export function getUpdate(slug: string): UpdatePromo | undefined {
  return UPDATES.find((u) => u.slug === slug);
}

export function getFeaturedUpdate(): UpdatePromo | undefined {
  return listUpdates().find((u) => u.featured) ?? listUpdates()[0];
}

/** Internal route for a promo — blog post or download page. */
export function updateHref(update: UpdatePromo): string {
  return update.kind === "download"
    ? `/download/${update.slug}`
    : `/updates/${update.slug}`;
}

export function listUpdatesByKind(kind: UpdateKind): UpdatePromo[] {
  return listUpdates().filter((u) => u.kind === kind);
}
