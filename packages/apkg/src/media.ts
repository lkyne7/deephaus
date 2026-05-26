import {
  extractCardMediaUrls,
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

function detectImageExt(bytes: Uint8Array): string | null {
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

function extensionFromUrl(url: string): string | null {
  const match = url.match(/\.(jpe?g|png|gif|webp)(?:$|[?#])/i);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

function buildMediaFilename(url: string, index: number, bytes: Uint8Array): string {
  const ext = extensionFromUrl(url) ?? detectImageExt(bytes) ?? "jpg";
  return `deephaus-${String(index).padStart(4, "0")}.${ext}`;
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
    for (const url of extractCardMediaUrls(...cardFields(card))) {
      allUrls.add(url);
    }
  }

  if (allUrls.size === 0) {
    return { cards, media: [], mediaBundled: 0, mediaSkipped: 0 };
  }

  const urlToFilename = new Map<string, string>();
  const media: PreparedMedia[] = [];
  let mediaBundled = 0;
  let mediaSkipped = 0;
  let index = 0;

  for (const url of allUrls) {
    const bytes = await fetchMedia(url);
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
