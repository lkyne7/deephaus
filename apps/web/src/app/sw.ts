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
        // Room for the desktop route warm-up (7 core routes + up to 20 decks)
        // on top of pages the user visits.
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 })],
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

// Study reminders. The payload is small and complete, so nothing has to be
// fetched before the notification can be shown.
type ReminderPush = { id?: string; title?: string; body?: string; path?: string };

self.addEventListener("push", (event) => {
  let reminder: ReminderPush = {};
  try {
    reminder = (event.data?.json() ?? {}) as ReminderPush;
  } catch {
    // A push with no readable payload still has to show something.
  }
  event.waitUntil(
    self.registration.showNotification(reminder.title || "DeepHaus", {
      body: reminder.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // A tag of its own. Chrome on macOS was seen to swallow every other
      // notification that reused one tag after the previous one was closed,
      // and a clicked reminder is always closed.
      tag: `deephaus-reminder-${reminder.id ?? Date.now()}`,
      data: { id: reminder.id ?? null, path: reminder.path ?? "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const { id, path } = (event.notification.data ?? {}) as { id: string | null; path?: string };
  event.notification.close();
  const target = new URL(path || "/dashboard", self.location.origin);
  // Only ever open this app.
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/dashboard`;
  event.waitUntil(
    (async () => {
      if (id) {
        // Opened reminders are how an ignored kind is told from a useful one.
        await fetch(`/api/notifications/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ opened: true }),
          credentials: "same-origin",
        }).catch(() => undefined);
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
