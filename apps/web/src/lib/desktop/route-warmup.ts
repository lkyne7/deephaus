/**
 * Cold-offline route warm-up for the desktop app.
 *
 * The service worker (src/app/sw.ts) caches a page's HTML only when that page
 * is requested with `Content-Type: text/html`, and its JS/CSS only when the
 * browser loads them. Pages the user has never opened therefore fall back to
 * `/~offline`. On desktop we fetch the core routes and each deck's study page
 * once per session so a cold offline launch can open any deck.
 */

export const CORE_ROUTES = ["/dashboard", "/decks", "/review", "/cards", "/cram", "/profile"] as const;

/** Keep below the `pages` cache limit in sw.ts, leaving room for visited pages. */
export const MAX_WARM_DECKS = 20;

export function studyRoutesForDecks(deckIds: readonly string[], limit = MAX_WARM_DECKS): string[] {
  const unique = Array.from(new Set(deckIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))));
  return unique.slice(0, limit).map((id) => `/decks/${id}/study`);
}

export function buildWarmupUrls(deckIds: readonly string[]): string[] {
  return [...CORE_ROUTES, ...studyRoutesForDecks(deckIds)];
}

/** Same-origin Next.js chunks and stylesheets referenced by a rendered page. */
export function extractStaticAssets(html: string): string[] {
  const assets = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+?\.(?:js|css))"/g)) {
    assets.add(match[1].replace(/&amp;/g, "&"));
  }
  return Array.from(assets);
}

export interface WarmupResult {
  pages: number;
  assets: number;
  failed: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch each route through the service worker so its HTML lands in the
 * `pages` cache, then fetch the chunks that HTML references so they land in
 * the static cache. Sequential on purpose: these are full server renders.
 */
export async function warmRoutes(
  urls: readonly string[],
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
): Promise<WarmupResult> {
  const result: WarmupResult = { pages: 0, assets: 0, failed: 0 };
  const fetchedAssets = new Set<string>();
  for (const url of urls) {
    if (signal?.aborted) break;
    try {
      const response = await fetchImpl(url, {
        credentials: "include",
        headers: { Accept: "text/html", "Content-Type": "text/html" },
        signal,
      });
      if (!response.ok) {
        result.failed += 1;
        continue;
      }
      result.pages += 1;
      const html = await response.text();
      for (const asset of extractStaticAssets(html)) {
        if (fetchedAssets.has(asset)) continue;
        fetchedAssets.add(asset);
        try {
          const assetResponse = await fetchImpl(asset, { credentials: "same-origin", signal });
          if (assetResponse.ok) result.assets += 1;
          else result.failed += 1;
        } catch {
          result.failed += 1;
        }
      }
    } catch {
      if (signal?.aborted) break;
      result.failed += 1;
    }
  }
  return result;
}
