import {
  extractAllCardMediaUrls,
  rewriteCardMediaForAnki,
  type GeneratedCard,
} from "@deephaus/shared";

export type MediaFetcher = (url: string) => Promise<Uint8Array | null>;

export type PreparedMedia = {
  filename: string;
  data: Uint8Array;
};

function cardFields(card: GeneratedCard): Array<string | null | undefined> {
  if (card.type === "basic") return [card.front, card.back, card.extra];
  return [card.clozeText, card.extra];
}

/** Image extension sniffed from leading bytes (jpg/png/gif/webp), else null. */
export function detectImageExt(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/** Audio extension sniffed from leading bytes (mp3/m4a/ogg/wav/webm), else null. */
export function detectAudioExt(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2) return "mp3"; // MPEG audio frame sync
  if (ascii(4, 8) === "ftyp") return "m4a";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  return null;
}

/** Image or audio extension sniffed from leading bytes, else null. */
export function detectMediaExt(bytes: Uint8Array): string | null {
  return detectImageExt(bytes) ?? detectAudioExt(bytes);
}

/** Media extension from a URL path, normalised (jpeg -> jpg), else null. */
export function extensionFromUrl(url: string): string | null {
  const match = url.match(/\.(jpe?g|png|gif|webp|mp3|m4a|aac|ogg|oga|opus|wav|webm|flac)(?:$|[?#])/i);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

/** Package filename for the index-th media file (1-based), e.g. deephaus-0001.png. */
export function mediaFilename(index: number, ext: string): string {
  return `deephaus-${String(index).padStart(4, "0")}.${ext}`;
}

function buildMediaFilename(url: string, index: number, bytes: Uint8Array): string {
  return mediaFilename(index, extensionFromUrl(url) ?? detectMediaExt(bytes) ?? "jpg");
}

function transformCardMedia(
  card: GeneratedCard,
  urlToFilename: ReadonlyMap<string, string>,
): GeneratedCard {
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

export async function prepareCardsForApkgExport(
  cards: GeneratedCard[],
  fetchMedia?: MediaFetcher,
): Promise<{
  cards: GeneratedCard[];
  media: PreparedMedia[];
  mediaBundled: number;
  mediaSkipped: number;
}> {
  if (!fetchMedia) {
    return { cards, media: [], mediaBundled: 0, mediaSkipped: 0 };
  }

  const allUrls = new Set<string>();
  for (const card of cards) {
    for (const url of extractAllCardMediaUrls(...cardFields(card))) {
      allUrls.add(url);
    }
  }

  if (allUrls.size === 0) {
    return { cards, media: [], mediaBundled: 0, mediaSkipped: 0 };
  }

  const urls = [...allUrls];
  const fetched = await mapPool(urls, MEDIA_FETCH_CONCURRENCY, async (url) => {
    const bytes = await fetchMedia(url);
    return { url, bytes };
  });

  const urlToFilename = new Map<string, string>();
  const media: PreparedMedia[] = [];
  let mediaBundled = 0;
  let mediaSkipped = 0;
  let index = 0;

  for (const { url, bytes } of fetched) {
    if (!bytes?.length) {
      mediaSkipped += 1;
      continue;
    }

    index += 1;
    const filename = buildMediaFilename(url, index, bytes);
    urlToFilename.set(url, filename);
    media.push({ filename, data: bytes });
    mediaBundled += 1;
  }

  const processed = cards.map((card) => transformCardMedia(card, urlToFilename));
  return { cards: processed, media, mediaBundled, mediaSkipped };
}

const MEDIA_FETCH_CONCURRENCY = 12;

/** Run async work over items with a fixed concurrency limit. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;

  async function runWorker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}
