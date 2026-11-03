"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { browserMediaManifest } from "./media-manifest";
import {
  localMediaUri,
  subscribeMedia,
  fetchWithDeadline,
  isDesktopApp,
  type MediaStorage,
  type MediaEntry,
} from "@deephaus/shared";
// The desktop app has disk to spare, so it downloads media without the flag.
export const mediaDownloadsEnabled =
  process.env.NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED === "true" || isDesktopApp();
let activeCache: string | null = null;
/** Audio clips are told apart from images by content type, or by extension when the type is generic. */
function isAudioMedia(url: string, contentType: string | null): boolean {
  if (contentType && /^audio\//i.test(contentType)) return true;
  return /\.(mp3|m4a|aac|ogg|oga|opus|wav|webm|flac)(?:$|[?#])/i.test(url);
}

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
      if (isAudioMedia(url, response.headers.get("content-type"))) {
        // Audio is verified by size and type; browsers cannot decode it synchronously.
        if (!/^audio\//i.test(blob.type) && !/^audio\//i.test(response.headers.get("content-type") ?? ""))
          throw new Error("Unreadable card audio");
      } else {
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
/**
 * Object URLs for cached media, shared across mounts. Without this every card
 * mount rendered the network URL first and swapped to the cached copy a moment
 * later, so images flashed and reloaded on each card in the reviewer.
 */
const MAX_RESOLVED_MEDIA = 200;
const resolvedMedia = new Map<string, string>();
const resolvingMedia = new Map<string, Promise<string | null>>();

function mediaKey(cache: string, original: string) {
  return `${cache}\n${original}`;
}

function rememberResolvedMedia(key: string, uri: string) {
  resolvedMedia.delete(key);
  resolvedMedia.set(key, uri);
  while (resolvedMedia.size > MAX_RESOLVED_MEDIA) {
    const [oldestKey, oldestUri] = resolvedMedia.entries().next().value as [string, string];
    resolvedMedia.delete(oldestKey);
    URL.revokeObjectURL(oldestUri);
  }
}

/** The cached object URL for `original`, if one has already been resolved. */
function peekLocalMedia(original: string): string | null {
  if (!activeCache || !localMediaUri(original)) return null;
  const key = mediaKey(activeCache, original);
  const uri = resolvedMedia.get(key);
  if (!uri) return null;
  // Keep recently shown media at the young end so eviction never revokes an image on screen.
  resolvedMedia.delete(key);
  resolvedMedia.set(key, uri);
  return uri;
}

/** Resolve `original` from the media cache to an object URL (deduplicated). */
function resolveLocalMedia(original: string): Promise<string | null> {
  const name = activeCache;
  if (!name || !localMediaUri(original)) return Promise.resolve(null);
  const key = mediaKey(name, original);
  const known = resolvedMedia.get(key);
  if (known) return Promise.resolve(known);
  const pending = resolvingMedia.get(key);
  if (pending) return pending;
  const promise = caches
    .open(name)
    .then((cache) => cache.match(original))
    .then(async (response) => {
      if (!response) return null;
      const uri = URL.createObjectURL(await response.blob());
      // The cache may have been cleared (sign-out) while this was in flight.
      if (activeCache !== name) {
        URL.revokeObjectURL(uri);
        return null;
      }
      rememberResolvedMedia(key, uri);
      return uri;
    })
    .catch(() => null)
    .finally(() => resolvingMedia.delete(key));
  resolvingMedia.set(key, promise);
  return promise;
}

/**
 * Fetch and decode a card image before it is shown, from the media cache when
 * it has been downloaded and from `fallback` (the network URL) otherwise.
 */
export function preloadCardImage(original: string, fallback = original): HTMLImageElement | null {
  if (typeof window === "undefined") return null;
  const image = new window.Image();
  image.decoding = "async";
  const load = (src: string) => {
    image.src = src;
    void image.decode().catch(() => undefined);
  };
  const cached = peekLocalMedia(original);
  if (cached) load(cached);
  else if (activeCache && localMediaUri(original)) void resolveLocalMedia(original).then((uri) => load(uri ?? fallback));
  else load(fallback);
  return image;
}

export function clearActiveMediaCache() {
  activeCache = null;
  for (const uri of resolvedMedia.values()) URL.revokeObjectURL(uri);
  resolvedMedia.clear();
  resolvingMedia.clear();
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
  // Re-render once an uncached URI resolves; the value itself lives in resolvedMedia.
  const [, setResolvedVersion] = useState(0);
  const cached = location ? peekLocalMedia(original) : null;
  useEffect(() => {
    if (!location || cached) return;
    let alive = true;
    void resolveLocalMedia(original).then((uri) => {
      if (alive && uri) setResolvedVersion((version) => version + 1);
    });
    return () => {
      alive = false;
    };
  }, [original, location, cached]);
  return cached ?? fallback;
}
