import yauzl from "yauzl";
import {
  isImageMediaFilename,
  maybeDecompress,
  parseMediaManifestBytes,
} from "@deephaus/apkg";
import type { MediaReader } from "@deephaus/anki-import";

/**
 * Random-access reader over an on-disk .apkg. yauzl reads only the zip's central
 * directory up front (cheap, constant memory even for multi-GB archives), then
 * inflates individual entries on demand. This is what lets the worker pull just
 * the collection + referenced images out of a 5 GB package without ever loading
 * the whole thing into memory.
 */
export class ApkgArchive {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    private readonly entries: Map<string, yauzl.Entry>,
  ) {}

  static open(path: string): Promise<ApkgArchive> {
    return new Promise((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
        if (err || !zip) {
          reject(err ?? new Error("Could not open Anki package archive."));
          return;
        }
        const entries = new Map<string, yauzl.Entry>();
        zip.on("entry", (entry: yauzl.Entry) => {
          entries.set(entry.fileName, entry);
          zip.readEntry();
        });
        zip.on("end", () => resolve(new ApkgArchive(zip, entries)));
        zip.on("error", reject);
        zip.readEntry();
      });
    });
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  readRaw(name: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(name);
    if (!entry) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      this.zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          reject(err ?? new Error(`Could not read "${name}" from archive.`));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        stream.on("error", reject);
      });
    });
  }

  close(): void {
    this.zip.close();
  }
}

const COLLECTION_CANDIDATES = [
  "collection.anki21b",
  "collection.anki21",
  "collection.anki2",
];

/** Locate and decompress the SQLite collection (newest format wins). */
export async function loadCollectionBytes(archive: ApkgArchive): Promise<Uint8Array> {
  for (const name of COLLECTION_CANDIDATES) {
    if (archive.has(name)) {
      const raw = await archive.readRaw(name);
      if (raw) return maybeDecompress(raw);
    }
  }
  throw new Error(
    "No Anki collection found in package (expected collection.anki2/anki21).",
  );
}

/** Lazy media reader backed by the archive's `media` manifest. */
export async function createArchiveMediaReader(archive: ApkgArchive): Promise<MediaReader> {
  const manifestBytes = archive.has("media") ? await archive.readRaw("media") : null;
  const manifest = manifestBytes ? parseMediaManifestBytes(manifestBytes) : {};
  const indexByName = new Map<string, string>();
  for (const [index, filename] of Object.entries(manifest)) {
    indexByName.set(filename, index);
  }

  return async (filename: string) => {
    if (!isImageMediaFilename(filename)) return null;
    const index = indexByName.get(filename);
    if (index == null) return null;
    const raw = await archive.readRaw(index);
    return raw ? maybeDecompress(raw) : null;
  };
}
