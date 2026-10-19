import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type JSZipType from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { ankiFieldToText, extractMediaFilenames, rewriteMediaRefs } from "../../packages/apkg/src/anki-html";
import { buildApkg } from "../../packages/apkg/src/builder";
import { parseApkg, isSupportedMediaFilename } from "../../packages/apkg/src/importer";
import { detectAudioExt, extensionFromUrl } from "../../packages/apkg/src/media";
import { getSql } from "../../packages/apkg/src/sql";
import { writeApkgStream } from "../../packages/anki-export/src/build";

// jszip is a dependency of the apkg package, not of the workspace root.
const JSZip = createRequire(new URL("../../packages/apkg/package.json", import.meta.url))("jszip") as typeof JSZipType;

// A minimal MPEG audio frame header (sync + MPEG-1 Layer III) followed by padding.
const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, ...new Array(60).fill(0)]);
const M4A = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, ...new Array(20).fill(0)]);

const dir = await mkdtemp(join(tmpdir(), "anki-audio-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("Anki field conversion with audio", () => {
  it("keeps [sound:] refs and <audio> tags as canonical audio markers", () => {
    expect(ankiFieldToText("Bonjour [sound:bonjour.mp3]")).toBe('Bonjour <audio src="bonjour.mp3"></audio>');
    expect(ankiFieldToText('<div>Murmur</div><div><audio src="s1.m4a" controls></audio></div>')).toBe('Murmur\n\n<audio src="s1.m4a"></audio>');
    expect(ankiFieldToText('<audio controls><source src="x.ogg" type="audio/ogg"></audio> text')).toBe('<audio src="x.ogg"></audio> text');
    expect(ankiFieldToText('<video src="v.mp4"></video> only text')).toBe("only text");
  });

  it("discovers and rewrites audio filenames alongside images", () => {
    const text = 'Q <img src="pic.png"> <audio src="say.mp3"></audio>';
    expect(extractMediaFilenames(text)).toEqual(["pic.png", "say.mp3"]);
    const rewritten = rewriteMediaRefs(text, new Map([["pic.png", "https://cdn.test/pic.png"], ["say.mp3", "https://cdn.test/say.mp3"]]));
    expect(rewritten).toBe('Q ![image](https://cdn.test/pic.png) <audio src="https://cdn.test/say.mp3"></audio>');
    expect(rewriteMediaRefs('<audio src="gone.mp3"></audio> kept', new Map())).toBe("kept");
  });

  it("recognises audio files and sniffs their type", () => {
    expect(["a.mp3", "b.m4a", "c.ogg", "d.wav", "e.webm", "f.png"].map(isSupportedMediaFilename)).toEqual([true, true, true, true, true, true]);
    expect(isSupportedMediaFilename("clip.mp4")).toBe(false);
    expect(detectAudioExt(MP3)).toBe("mp3");
    expect(detectAudioExt(M4A)).toBe("m4a");
    expect(extensionFromUrl("https://cdn.test/u/c/1-clip.M4A?x=1")).toBe("m4a");
  });
});

describe("Anki audio round trip", () => {
  it("imports a package's [sound:] clip and exports it back as [sound:]", async () => {
    // Build a package whose field carries an Anki sound tag and bundle the clip.
    const generated = await buildApkg({
      deckName: "Audio",
      cards: [{ type: "basic", front: "Bonjour [sound:bonjour.mp3]", back: "Hello", tags: [] }],
    });
    const zip = await JSZip.loadAsync(generated.bytes);
    zip.file("0", MP3);
    zip.file("media", JSON.stringify({ "0": "bonjour.mp3" }));
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const parsed = await parseApkg(bytes, { fsrsParamCount: 21 });
    expect(parsed.media.get("bonjour.mp3")).toEqual(MP3);
    const card = parsed.decks[0].cards[0];
    expect(card.front).toBe('Bonjour <audio src="bonjour.mp3"></audio>');

    // Importing hosts the clip; the field then points at the hosted URL.
    const hosted = "https://cdn.test/card-media/u/anki/bonjour.mp3";
    const front = rewriteMediaRefs(card.front, new Map([["bonjour.mp3", hosted]]));
    expect(front).toBe(`Bonjour <audio src="${hosted}"></audio>`);

    // Exporting fetches the clip and writes an Anki sound tag.
    const outputPath = join(dir, "audio.apkg");
    const result = await writeApkgStream({
      deckName: "Audio export",
      cards: [{ id: "1", type: "basic", front, back: "Hello", cloze_text: null, extra: null, tags: [] }],
      outputPath,
      fetchMedia: async (url) => (url === hosted ? MP3 : null),
    });
    expect(result).toMatchObject({ mediaBundled: 1, mediaSkipped: 0 });

    const exported = await readFile(outputPath);
    const reparsed = await parseApkg(new Uint8Array(exported), { fsrsParamCount: 21 });
    expect([...reparsed.media.keys()]).toEqual(["deephaus-0001.mp3"]);
    expect(reparsed.decks[0].cards[0].front).toBe('Bonjour <audio src="deephaus-0001.mp3"></audio>');

    // Anki itself sees the raw field with its native tag.
    const exportedZip = await JSZip.loadAsync(exported);
    const SQL = await getSql();
    const db = new SQL.Database(await exportedZip.file("collection.anki2")!.async("uint8array"));
    const [flds] = db.exec("select flds from notes")[0].values[0] as string[];
    db.close();
    expect(flds.split("\u001f")[0]).toBe("Bonjour [sound:deephaus-0001.mp3]");
  });
});
