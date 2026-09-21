import { extractCardMediaUrls } from "./card-content.js";
export type LibraryCardMedia = {
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  occlusion_data?: unknown;
};
export function requiredCardMedia(card: LibraryCardMedia): string[] {
  const urls = extractCardMediaUrls(
    card.front,
    card.back,
    card.cloze_text,
    card.extra,
  );
  try {
    const occlusion =
      typeof card.occlusion_data === "string"
        ? JSON.parse(card.occlusion_data)
        : card.occlusion_data;
    if (occlusion && typeof occlusion.imageUrl === "string")
      urls.push(occlusion.imageUrl);
  } catch {
    /* Invalid card content is handled by the card renderer. */
  }
  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))];
}
export type MediaEntry = {
  url: string;
  localUri?: string;
  bytes: number;
  attempts: number;
  error?: string;
};
export interface MediaStorage {
  load(): Promise<MediaEntry[]>;
  save(entries: MediaEntry[]): Promise<void>;
  /** Durable incremental progress; avoids rewriting the entire library per image. */
  saveEntry?(entry: MediaEntry): Promise<void>;
  exists(entry: MediaEntry): Promise<boolean>;
  download(
    url: string,
    signal: AbortSignal,
  ): Promise<{ localUri: string; bytes: number }>;
  remove(entry: MediaEntry): Promise<void>;
}
export type MediaReadiness = {
  state: "Downloading" | "Ready offline" | "Paused" | "Needs attention";
  total: number;
  downloaded: number;
  bytes: number;
  dataReady: boolean;
  error: string | null;
};
/** Account-local queue. Completed items survive restarts; interrupted items are retried. */
export class OfflineMediaLibrary {
  private entries = new Map<string, MediaEntry>();
  private controller = new AbortController();
  private running: Promise<void> | null = null;
  private downloadController: AbortController | null = null;
  private loaded = false;
  private initializing: Promise<void> | null = null;
  private paused = false;
  private dataReady = false;
  private failure: string | null = null;
  private lastPublishedAt = 0;
  constructor(
    private storage: MediaStorage,
    private changed: (state: MediaReadiness, entries: MediaEntry[]) => void,
  ) {}
  private publish(force = true) {
    const now = Date.now();
    if (!force && now - this.lastPublishedAt < 250) return;
    this.lastPublishedAt = now;
    const all = [...this.entries.values()],
      downloaded = all.filter((e) => e.localUri).length;
    const error =
      this.failure ??
      (all.some((e) => e.error)
        ? "Some media could not be downloaded. Check storage and connection, then retry."
        : null);
    this.changed(
      {
        state: error
          ? "Needs attention"
          : this.loaded && this.dataReady && downloaded === all.length
            ? "Ready offline"
            : this.paused
              ? "Paused"
              : "Downloading",
        total: all.length,
        downloaded,
        bytes: all.reduce((sum, e) => sum + e.bytes, 0),
        dataReady: this.dataReady,
        error,
      },
      all,
    );
  }
  initialize(): Promise<void> {
    if (this.loaded || this.controller.signal.aborted) return Promise.resolve();
    if (!this.initializing) {
      this.initializing = this.loadManifest().finally(() => {
        this.initializing = null;
      });
    }
    return this.initializing;
  }
  private async loadManifest() {
    try {
      const entries = await this.storage.load();
      if (this.controller.signal.aborted) return;
      this.entries = new Map(entries.map((entry) => [entry.url, entry]));
      await this.verify();
      this.loaded = true;
      this.failure = null;
    } catch {
      this.failure =
        "Device storage is unavailable. Offline readiness cannot be verified.";
    }
    this.publish();
  }
  async verify(urls?: string[]) {
    const changed: MediaEntry[] = [];
    const selected = urls
      ? urls
          .map((url) => this.entries.get(url))
          .filter((entry): entry is MediaEntry => !!entry)
      : this.entries.values();
    for (const entry of selected)
      if (entry.localUri && !(await this.storage.exists(entry))) {
        delete entry.localUri;
        entry.bytes = 0;
        changed.push(entry);
      }
    if (changed.length) {
      if (this.storage.saveEntry) {
        for (const entry of changed) await this.storage.saveEntry(entry);
      } else await this.storage.save([...this.entries.values()]);
      this.publish();
    }
  }
  async reconcile(urls: string[], dataReady: boolean) {
    // Never replace durable progress with an empty queue after a failed read.
    await this.initialize();
    if (!this.loaded) return;
    if (this.controller.signal.aborted) return;
    this.dataReady = dataReady;
    // An incomplete initial replica must not prune a previously downloaded library.
    if (dataReady) {
      const wanted = new Set(urls);
      for (const [url, entry] of this.entries)
        if (!wanted.has(url)) {
          await this.storage.remove(entry);
          this.entries.delete(url);
        }
    }
    for (const url of urls)
      if (!this.entries.has(url))
        this.entries.set(url, { url, bytes: 0, attempts: 0 });
    // Preserve due-card priority from the caller, without losing retained entries on partial sync.
    const priority = new Set(urls);
    this.entries = new Map([
      ...urls.map((url) => [url, this.entries.get(url)!] as const),
      ...Array.from(this.entries).filter(([url]) => !priority.has(url)),
    ]);
    await this.storage.save([...this.entries.values()]);
    this.publish();
  }
  setDataReady(ready: boolean) {
    this.dataReady = ready;
    this.publish();
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.downloadController?.abort();
    this.publish();
  }
  stop() {
    this.controller.abort();
    this.downloadController?.abort();
  }
  async run(retry = false): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain(retry).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain(retry: boolean) {
    await this.initialize();
    if (!this.loaded || this.controller.signal.aborted) return;
    if (retry) {
      this.failure = null;
      for (const e of this.entries.values()) delete e.error;
    }
    try {
      for (const entry of this.entries.values()) {
        if (this.paused || this.controller.signal.aborted) break;
        if (entry.localUri || entry.error) continue;
        entry.attempts++;
        try {
          this.downloadController = new AbortController();
          const downloaded = await this.storage.download(
            entry.url,
            this.downloadController.signal,
          );
          if (this.controller.signal.aborted) break;
          Object.assign(entry, downloaded);
          delete entry.error;
        } catch {
          if (this.controller.signal.aborted || this.paused) break;
          entry.error = "Download failed";
        } finally {
          this.downloadController = null;
        }
        if (this.storage.saveEntry) await this.storage.saveEntry(entry);
        else await this.storage.save([...this.entries.values()]);
        this.publish(false);
      }
    } catch {
      this.failure =
        "Device storage is full or unavailable. Free space and retry.";
    }
    this.publish();
  }
}
// Renderers only see the active account's managed files.
let locations = new Map<string, string>();
let revision = 0;
const listeners = new Set<() => void>();
export function setActiveMedia(entries: MediaEntry[]) {
  locations = new Map(
    entries.filter((e) => e.localUri).map((e) => [e.url, e.localUri!]),
  );
  revision++;
  for (const fn of listeners) fn();
}
export const subscribeMedia = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const mediaRevision = () => revision;
export function localMediaUri(url: string) {
  return locations.get(url);
}
export function hasCardMedia(card: LibraryCardMedia) {
  return requiredCardMedia(card).every((url) => locations.has(url));
}
/** Only call for an offline queue. Text-only cards remain available immediately. */
export function deferUnavailableMedia<T extends { cards: LibraryCardMedia[] }>(
  payload: T,
): T & { offline_media_deferred: number } {
  const cards = payload.cards.filter(hasCardMedia),
    deferred = payload.cards.length - cards.length;
  if (deferred && !cards.length)
    throw new Error(
      "These cards need media that has not downloaded. Reconnect and finish the library download before studying them.",
    );
  return { ...payload, cards, offline_media_deferred: deferred };
}

let verifyMedia: ((urls: string[]) => Promise<void>) | null = null;
export function setActiveMediaVerifier(verify: typeof verifyMedia) {
  verifyMedia = verify;
}
export async function ensureCardMedia(card: LibraryCardMedia) {
  const urls = requiredCardMedia(card);
  if (!urls.length) return;
  if (verifyMedia) await verifyMedia(urls);
  if (!urls.every((url) => locations.has(url)))
    throw new Error(
      "This card is deferred because its media is unavailable. Reconnect to finish downloading your library.",
    );
}
