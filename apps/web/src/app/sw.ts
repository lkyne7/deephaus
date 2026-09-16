import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { defaultCache, PAGES_CACHE_NAME } from "@serwist/next/worker";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("activate", (event) => {
  // Older releases cached authenticated API responses in the shared "apis"
  // cache. Remove those entries so empty/stale user data cannot survive an
  // application upgrade.
  event.waitUntil(caches.delete("apis"));
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // defaultCache serves Next.js JS/CSS/fonts/images cache-first and pages
  // network-first, so previously visited routes render offline; page data then
  // comes from the local PowerSync replica via the intercepted fetch layer.
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && pathname.startsWith("/api/"),
      method: "GET",
      handler: new NetworkOnly(),
    },
    {
      // cacheOnNavigation writes HTML to "pages". Browser document requests
      // usually have no Content-Type header, so the default matcher would read
      // "others" instead and miss that HTML on a cold offline navigation.
      matcher: ({ sameOrigin, request, url: { pathname } }) =>
        sameOrigin && !pathname.startsWith("/api/") &&
        (request.mode === "navigate" || request.headers.get("Content-Type")?.includes("text/html") === true),
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE_NAME.html,
        plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
