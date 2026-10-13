import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { once } from "node:events";
import yazl from "yazl";
import {
  buildCollection,
  detectImageExt,
  draftCardsToGenerated,
  extensionFromUrl,
  mediaFilename,
  type ExportCardProgress,
} from "@deephaus/apkg";
import {
  extractCardMediaUrls,
  isAllowedImageSrc,
  rewriteCardMediaForAnki,
  type GeneratedCard,
} from "@deephaus/shared";
import type { ExportCardRow } from "./data.js";

/** Resolves to the image's byte stream, or null to skip it. */
export type MediaStreamFetcher = (url: string) => Promise<ReadableStream<Uint8Array> | null>;

export interface StreamExportOptions {
  deckName: string;
  cards: ExportCardRow[];
  /** Scheduling and history per card, parallel to `cards`. */
  progress?: Array<ExportCardProgress | undefined>;
  /** Where the finished .apkg is written. */
  outputPath: string;
  description?: string;
  fetchMedia?: MediaStreamFetcher;
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

/** Fetch one image over HTTP, streaming; rejects non-image responses. */
export const fetchMediaStream: MediaStreamFetcher = async (url) => {
  if (!isAllowedImageSrc(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
    if (!response.ok || !response.body) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/")) return null;
    return response.body;
  } catch {
    return null;
  }
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
 * Write a deck to an .apkg on disk with constant memory. Each image is
 * streamed from its URL straight into the zip, one at a time (yazl asks for
 * the next entry's stream only once the previous one is written), and the
 * collection and media manifest are added last so filenames can be decided
 * from each image's bytes. The collection itself is built in memory; it holds
 * only card text and schedules.
 */
export async function writeApkgStream(options: StreamExportOptions): Promise<StreamExportResult> {
  const generated = draftCardsToGenerated(options.cards);
  const fetchMedia = options.fetchMedia ?? fetchMediaStream;

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const card of generated) {
    for (const url of extractCardMediaUrls(...cardFields(card))) {
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

  // Zip member "i" holds the i-th image; the manifest maps it to a filename.
  urls.forEach((url, index) => {
    zip.addReadStreamLazy(String(index), { compress: false }, (callback) => {
      void (async () => {
        let source: ReadableStream<Uint8Array> | null = null;
        try {
          source = await fetchMedia(url);
        } catch {
          source = null;
        }
        if (!source) {
          mediaSkipped += 1;
          mediaDone += 1;
          await options.onProgress?.({ phase: "media", done: mediaDone, total: urls.length });
          callback(null, Readable.from([]));
          return;
        }

        let ext: string | null = extensionFromUrl(url);
        let bytes = 0;
        const sniff = new Transform({
          transform(chunk: Buffer, _encoding, next) {
            if (bytes === 0 && !ext) ext = detectImageExt(chunk);
            bytes += chunk.length;
            next(null, chunk);
          },
          flush(next) {
            if (bytes > 0) {
              mediaBundled += 1;
              const filename = mediaFilename(mediaBundled, ext ?? "jpg");
              urlToFilename.set(url, filename);
              manifest[String(index)] = filename;
            } else {
              mediaSkipped += 1;
            }
            mediaDone += 1;
            Promise.resolve(options.onProgress?.({ phase: "media", done: mediaDone, total: urls.length }))
              .then(() => next(), () => next());
          },
        });
        const node = Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]);
        // A failed download mid-stream ends the entry short rather than the whole export.
        node.once("error", () => sniff.end());
        callback(null, node.pipe(sniff));
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
