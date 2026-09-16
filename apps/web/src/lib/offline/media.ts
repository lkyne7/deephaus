"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { browserMediaManifest } from "./media-manifest";
import {
  localMediaUri,
  subscribeMedia,
  fetchWithDeadline,
  type MediaStorage,
  type MediaEntry,
} from "@deephaus/shared";
export const mediaDownloadsEnabled =
  process.env.NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED === "true";
let activeCache: string | null = null;
export function browserMediaStorage(userId: string): MediaStorage {
  const name = `deephaus-media-${userId}`;
  const manifest = browserMediaManifest(userId);
  activeCache = name;
  return {
    async load() {
      void navigator.storage?.persist?.().catch(() => false);
      return manifest.load();
    },
    save: manifest.save,
    saveEntry: manifest.saveEntry,
    async exists(entry) {
      const response = await (await caches.open(name)).match(entry.url);
      return (
        !!response &&
        Number(response.headers.get("x-deephaus-media-bytes")) ===
          entry.bytes &&
        entry.bytes > 0
      );
    },
    async download(url, signal) {
      const response = await fetchWithDeadline(
        url,
        { signal, credentials: "omit" },
        60_000,
      );
      if (!response.ok || response.type === "opaque")
        throw new Error("Media unavailable");
      const blob = await response.clone().blob();
      const bytes = blob.size;
      if (bytes === 0) throw new Error("Empty media");
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error("Unreadable card image");
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      const headers = new Headers(response.headers);
      headers.set("x-deephaus-media-bytes", String(bytes));
      await (await caches.open(name)).put(url, new Response(blob, { headers }));
      return { localUri: url, bytes };
    },
    async remove(entry: MediaEntry) {
      await (await caches.open(name)).delete(entry.url);
    },
  };
}
export function clearActiveMediaCache() {
  activeCache = null;
}
export function useMediaUri(original: string, fallback = original) {
  const location = useSyncExternalStore(
    subscribeMedia,
    () =>
      activeCache && localMediaUri(original)
        ? `${activeCache}:${original}`
        : "",
    () => "",
  );
  const [resolved, setResolved] = useState<{
    original: string;
    uri: string;
    cache: string | null;
  } | null>(null);
  useEffect(() => {
    let alive = true,
      objectUrl: string | null = null;
    const name = activeCache;
    if (!name || !localMediaUri(original)) {
      setResolved(null);
      return;
    }
    void caches
      .open(name)
      .then((cache) => cache.match(original))
      .then(async (response) => {
        if (!response || !alive) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (alive) setResolved({ original, uri: objectUrl, cache: name });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => setResolved(null));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [original, location]);
  return resolved?.original === original && resolved.cache === activeCache
    ? resolved.uri
    : fallback;
}
