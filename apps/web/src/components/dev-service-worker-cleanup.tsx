"use client";

import { useEffect } from "react";

const RELOAD_KEY = "deephaus:dev-sw-cleanup";
// Runtime cache names from @serwist/next/worker. Application data (including
// account-scoped media) is durable user storage, not a stale build artifact.
const WORKER_CACHES = new Set([
  "google-fonts-webfonts", "google-fonts-stylesheets", "static-font-assets",
  "static-image-assets", "next-static-js-assets", "next-image", "static-audio-assets",
  "static-video-assets", "static-js-assets", "static-style-assets", "next-data",
  "static-data-assets", "apis", "pages-rsc-prefetch", "pages-rsc", "pages",
  "others", "cross-origin", "start-url",
]);

/**
 * A production PWA service worker can keep controlling localhost after switching
 * back to `next dev`, serving stale chunks and rewriting dev asset requests.
 * Serwist is disabled in development, so clean up any previously installed
 * production worker and its Cache Storage entries.
 */
export function DevServiceWorkerCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    void (async () => {
      const wasControlled = Boolean(navigator.serviceWorker?.controller);

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }

      if ("caches" in globalThis) {
        const cacheKeys = await globalThis.caches.keys();
        await Promise.all(cacheKeys
          .filter((key) => WORKER_CACHES.has(key) || /^(serwist|workbox)-/.test(key))
          .map((key) => globalThis.caches.delete(key)));
      }

      // Unregistering releases the current page only after a reload.
      if (wasControlled && sessionStorage.getItem(RELOAD_KEY) !== "1") {
        sessionStorage.setItem(RELOAD_KEY, "1");
        window.location.reload();
        return;
      }

      sessionStorage.removeItem(RELOAD_KEY);
    })().catch((error) => {
      console.warn("[dev] Failed to clean up stale service worker state", error);
    });
  }, []);

  return null;
}
