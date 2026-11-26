/** Canonical public origin for metadata, sitemap and robots. */
export const SITE_URL = "https://www.deephaus.ai";

/**
 * Only the real domain may be indexed. Staging, previews and local builds stay
 * out of search results. The request host decides, so a missing build variable
 * or a reused build can't hide the production site.
 */
export function hostIsIndexable(host: string | null): boolean {
  const name = host?.trim().toLowerCase().replace(/:\d+$/, "");
  return name === "www.deephaus.ai" || name === "deephaus.ai";
}

/** Public marketing pages that belong in the sitemap. */
export const PUBLIC_PAGES: ReadonlyArray<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/pricing", priority: 0.8 },
  { path: "/download", priority: 0.8 },
  { path: "/integrations", priority: 0.7 },
  { path: "/support", priority: 0.4 },
  { path: "/privacy", priority: 0.2 },
  { path: "/terms", priority: 0.2 },
];
