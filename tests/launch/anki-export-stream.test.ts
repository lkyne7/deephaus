import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeApkgStream } from "../../packages/anki-export/src/build";
import type { ExportCardRow } from "../../packages/anki-export/src/data";
import { parseApkg } from "../../packages/apkg/src/importer";
import { ApkgArchive, loadCollectionBytes } from "../../apps/anki-worker/src/zip-reader";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const MEDIA: Record<string, Uint8Array | null> = {
  "https://cdn.test/card-media/a.png": PNG,
  "https://cdn.test/card-media/noext": JPG,
  "https://cdn.test/card-media/missing.png": null,
};

const cards: ExportCardRow[] = [
  { id: "1", type: "basic", front: 'One <img src="https://cdn.test/card-media/a.png">', back: "Back one", cloze_text: null, extra: null, tags: ["t"] },
  { id: "2", type: "cloze", front: null, back: null, cloze_text: "Two {{c1::x}} ![pic](https://cdn.test/card-media/noext)", extra: '<img src="https://cdn.test/card-media/a.png">', tags: [] },
  { id: "3", type: "basic", front: 'Three <img src="https://cdn.test/card-media/missing.png">', back: "Back three", cloze_text: null, extra: null, tags: [] },
  { id: "4", type: "basic", front: "", back: "Skipped", cloze_text: null, extra: null, tags: [] },
];

// Streams each image one chunk at a time, the way a network body arrives.
const fetchMedia = async (url: string) => {
  const bytes = MEDIA[url];
  if (!bytes) return null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 4));
      controller.enqueue(bytes.slice(4));
      controller.close();
    },
  });
};

const dir = await mkdtemp(join(tmpdir(), "anki-export-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("writeApkgStream", () => {
  it("streams media into a package our importer and the worker's reader both accept", async () => {
    const outputPath = join(dir, "stream.apkg");
    const events: string[] = [];
    const result = await writeApkgStream({
      deckName: "Streamed",
      cards,
      progress: [
        { reviews: [{ clozeOrd: 0, due: new Date(Date.now() + 86_400_000).toISOString(), stability: 5, difficulty: 5, scheduledDays: 3, reps: 2, lapses: 0, state: 2, suspended: false }], logs: [] },
      ],
      outputPath,
      fetchMedia,
      onProgress: ({ phase, done, total }) => { events.push(`${phase}:${done}/${total}`); },
    });

    expect(result).toMatchObject({ cardCount: 3, skipped: 1, mediaBundled: 2, mediaSkipped: 1, scheduledExported: 1 });
    expect(result.bytes).toBeGreaterThan(0);
    expect(events).toEqual(["media:1/3", "media:2/3", "media:3/3", "packaging:0/1", "packaging:1/1"]);

    const bytes = await readFile(outputPath);
    const parsed = await parseApkg(new Uint8Array(bytes), { fsrsParamCount: 21 });
    expect(parsed.stats.cardCount).toBe(3);
    expect([...parsed.media.keys()].sort()).toEqual(["deephaus-0001.png", "deephaus-0002.jpg"]);
    expect(parsed.media.get("deephaus-0002.jpg")).toEqual(JPG);
    const byFront = new Map(parsed.decks.flatMap((d) => d.cards).map((c) => [c.front ?? c.clozeText ?? "", c]));
    expect([...byFront.keys()].find((k) => k.startsWith("One"))).toContain("deephaus-0001.png");
    expect([...byFront.keys()].find((k) => k.startsWith("Two"))).toContain("deephaus-0002.jpg");
    // A failed download leaves the reference out rather than pointing at a missing file.
    expect([...byFront.keys()].find((k) => k.startsWith("Three"))).not.toContain("missing");
    expect(byFront.get([...byFront.keys()].find((k) => k.startsWith("One"))!)!.reviews[0].fields.state).toBe(2);

    const archive = await ApkgArchive.open(outputPath);
    try {
      const collection = await loadCollectionBytes(archive);
      expect(new TextDecoder().decode(collection.slice(0, 15))).toBe("SQLite format 3");
    } finally {
      archive.close();
    }
  });

  it("writes a plain package when nothing has media or progress", async () => {
    const outputPath = join(dir, "plain.apkg");
    const result = await writeApkgStream({
      deckName: "Plain",
      cards: [{ id: "1", type: "basic", front: "Q", back: "A", cloze_text: null, extra: null, tags: [] }],
      outputPath,
      fetchMedia: async () => null,
    });
    expect(result).toMatchObject({ cardCount: 1, mediaBundled: 0, mediaSkipped: 0 });
    const parsed = await parseApkg(new Uint8Array(await readFile(outputPath)), { fsrsParamCount: 21 });
    expect(parsed.stats.cardCount).toBe(1);
    expect(parsed.media.size).toBe(0);
  });
});
