import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { once } from "node:events";
import yazl from "yazl";
import {
  buildCollection,
  detectMediaExt,
  draftCardsToGenerated,
  extensionFromUrl,
  mediaFilename,
  type ExportCardProgress,
} from "@deephaus/apkg";
import {
  extractAllCardMediaUrls,
  isAllowedMediaSrc,
  rewriteCardMediaForAnki,
  type GeneratedCard,
} from "@deephaus/shared";
import type { ExportCardRow } from "./data.js";

/** Resolves to the whole image, or null to skip it. */
export type MediaBytesFetcher = (url: string) => Promise<Uint8Array | null>;

export interface StreamExportOptions {
  deckName: string;
  cards: ExportCardRow[];
  /** Scheduling and history per card, parallel to `cards`. */
  progress?: Array<ExportCardProgress | undefined>;
  /** Where the finished .apkg is written. */
  outputPath: string;
  description?: string;
  fetchMedia?: MediaBytesFetcher;
  onProgress?: (update: { phase: "media" | "packaging"; done: number; total: number }) => void | Promise<void>;
}

export interface StreamExportResult {
  bytes: number;
  cardCount: number;
  skipped: number;
  mediaBundled: number;
  mediaSkipped: number;
  scheduledExported: number;
  suspendedExported: number;
  reviewLogsExported: number;
}

const MEDIA_FETCH_TIMEOUT_MS = 120_000;
/**
 * Images are written to the zip one at a time, but up to this many following
 * images download in the meantime so per-object latency overlaps with writing.
 */
const MEDIA_PREFETCH = 4;
/** Attempts per image; a retry covers failures anywhere in the download, including mid-body. */
const MEDIA_FETCH_ATTEMPTS = 4;
/**
 * Larger images are skipped. Card images are capped at 5 MB in storage; this
 * bounds memory for images hosted elsewhere (at most PREFETCH + 1 are held).
 */
const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

class PermanentMediaError extends Error {}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function downloadImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    const message = `HTTP ${response.status}`;
    throw isRetryableStatus(response.status) ? new Error(message) : new PermanentMediaError(message);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/") && !contentType.startsWith("audio/")) {
    await response.body.cancel().catch(() => undefined);
    throw new PermanentMediaError(`not an image or audio clip (${contentType})`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > MEDIA_MAX_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new PermanentMediaError(`too large (${declared} bytes)`);
  }

  // Read the whole body before any byte reaches the zip, so a connection that
  // drops partway is retried instead of leaving a truncated entry.
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MEDIA_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PermanentMediaError(`too large (over ${MEDIA_MAX_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  if (Number.isFinite(declared) && declared > 0 && length !== declared) {
    throw new Error(`short body (${length} of ${declared} bytes)`);
  }
  if (length === 0) throw new Error("empty body");
  return Buffer.concat(chunks, length);
}

/** Download one image with retries; null (logged) when it cannot be fetched. */
export const fetchMediaBytes: MediaBytesFetcher = async (url) => {
  if (!isAllowedMediaSrc(url)) return null;
  let reason = "unknown error";
  for (let attempt = 1; attempt <= MEDIA_FETCH_ATTEMPTS; attempt++) {
    try {
      return await downloadImage(url);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      if (error instanceof PermanentMediaError) break;
      if (attempt < MEDIA_FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      }
    }
  }
  console.warn(`[anki-export] skipped image ${url}: ${reason}`);
  return null;
};

function cardFields(card: GeneratedCard): Array<string | null | undefined> {
  return card.type === "basic" ? [card.front, card.back, card.extra] : [card.clozeText, card.extra];
}

function rewriteMedia(card: GeneratedCard, urlToFilename: ReadonlyMap<string, string>): GeneratedCard {
  if (card.type === "basic") {
    return {
      ...card,
      front: rewriteCardMediaForAnki(card.front, urlToFilename),
      back: rewriteCardMediaForAnki(card.back, urlToFilename),
      extra: rewriteCardMediaForAnki(card.extra, urlToFilename),
    };
  }
  return {
    ...card,
    clozeText: rewriteCardMediaForAnki(card.clozeText, urlToFilename),
    extra: rewriteCardMediaForAnki(card.extra, urlToFilename),
  };
}

/**
 * Write a deck to an .apkg on disk with bounded memory. Each image is
 * downloaded whole (with retries), then written into the zip, one at a time
 * (yazl asks for the next entry only once the previous one is written), and the
 * collection and media manifest are added last so filenames can be decided
 * from each image's bytes. The collection itself is built in memory; it holds
 * only card text and schedules.
 */
export async function writeApkgStream(options: StreamExportOptions): Promise<StreamExportResult> {
  const generated = draftCardsToGenerated(options.cards);
  const fetchMedia = options.fetchMedia ?? fetchMediaBytes;

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const card of generated) {
    for (const url of extractAllCardMediaUrls(...cardFields(card))) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  const zip = new yazl.ZipFile();
  const output = createWriteStream(options.outputPath);
  zip.outputStream.pipe(output);
  const failed = new Promise<never>((_, reject) => {
    zip.outputStream.once("error", reject);
    output.once("error", reject);
  });

  const urlToFilename = new Map<string, string>();
  const manifest: Record<string, string> = {};
  let mediaBundled = 0;
  let mediaSkipped = 0;
  let mediaDone = 0;

  // Requests in flight, keyed by media index; a failed fetch resolves to null.
  const inflight = new Map<number, Promise<Uint8Array | null>>();
  const startFetch = (index: number) => {
    let request = inflight.get(index);
    if (!request) {
      request = fetchMedia(urls[index]).catch(() => null);
      inflight.set(index, request);
    }
    return request;
  };

  // Zip member "i" holds the i-th image; the manifest maps it to a filename.
  urls.forEach((url, index) => {
    zip.addReadStreamLazy(String(index), { compress: false }, (callback) => {
      void (async () => {
        for (let ahead = index + 1; ahead <= index + MEDIA_PREFETCH && ahead < urls.length; ahead++) {
          startFetch(ahead);
        }
        const bytes = await startFetch(index);
        inflight.delete(index);
        if (bytes && bytes.length > 0) {
          mediaBundled += 1;
          const filename = mediaFilename(mediaBundled, extensionFromUrl(url) ?? detectMediaExt(bytes) ?? "jpg");
          urlToFilename.set(url, filename);
          manifest[String(index)] = filename;
        } else {
          // The card drops its reference; the empty member is unreferenced.
          mediaSkipped += 1;
        }
        mediaDone += 1;
        await Promise.resolve(options.onProgress?.({ phase: "media", done: mediaDone, total: urls.length }))
          .catch(() => undefined);
        callback(null, Readable.from(bytes && bytes.length > 0 ? [Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)] : []));
      })();
    });
  });

  // Added last: by the time yazl asks for these, every image is written.
  let collectionResult: Awaited<ReturnType<typeof buildCollection>> | undefined;
  zip.addReadStreamLazy("collection.anki2", { compress: true }, (callback) => {
    void (async () => {
      try {
        await options.onProgress?.({ phase: "packaging", done: 0, total: 1 });
        collectionResult = await buildCollection({
          deckName: options.deckName,
          cards: generated.map((card) => rewriteMedia(card, urlToFilename)),
          progress: options.progress,
          description: options.description,
        });
        callback(null, Readable.from([Buffer.from(collectionResult.collectionBytes)]));
      } catch (error) {
        callback(error as Error, undefined as unknown as Readable);
      }
    })();
  });
  zip.addReadStreamLazy("media", { compress: true }, (callback) => {
    callback(null, Readable.from([Buffer.from(JSON.stringify(manifest))]));
  });
  zip.end();

  await Promise.race([once(output, "finish"), failed]);
  await options.onProgress?.({ phase: "packaging", done: 1, total: 1 });
  if (!collectionResult) throw new Error("Export finished without a collection");

  return {
    bytes: output.bytesWritten,
    cardCount: collectionResult.cardCount,
    skipped: collectionResult.skipped,
    mediaBundled,
    mediaSkipped,
    scheduledExported: collectionResult.scheduledExported,
    suspendedExported: collectionResult.suspendedExported,
    reviewLogsExported: collectionResult.reviewLogsExported,
  };
}
