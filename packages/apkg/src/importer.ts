import JSZip from "jszip";
import { decompress as zstdDecompress } from "fzstd";
import type { Database, SqlValue } from "sql.js";
import { getSql } from "./sql.js";
import { ankiFieldToText } from "./anki-html.js";
import { ankiCardToFsrs, type FsrsReviewFields } from "./anki-scheduling.js";
import {
  extractDeckConfigId,
  extractDeckPreset,
  parseMediaEntries,
  type AnkiDeckPreset,
} from "./anki-protobuf.js";

export interface ImportedReview {
  clozeOrd: number;
  fields: FsrsReviewFields;
}

export interface ImportedCard {
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  clozeText: string | null;
  extra: string | null;
  tags: string[];
  sortOrder: number;
  reviews: ImportedReview[];
}

export interface ImportedDeck {
  ankiDeckId: string;
  name: string;
  preset?: AnkiDeckPreset;
  cards: ImportedCard[];
}

export interface ParsedApkg {
  decks: ImportedDeck[];
  /** filename -> raw bytes for bundled image media (audio/video excluded). */
  media: Map<string, Uint8Array>;
  stats: {
    deckCount: number;
    noteCount: number;
    cardCount: number;
    scheduledCount: number;
    suspendedCount: number;
    mediaCount: number;
    fsrsPresetCount: number;
  };
}

export interface ParseApkgOptions {
  /** Installed ts-fsrs `default_w.length`; FSRS presets of other lengths are rejected. */
  fsrsParamCount: number;
  /**
   * When false, skip loading all media into memory (use with {@link readApkgMediaFile}
   * while importing large packages).
   */
  eagerMedia?: boolean;
}

export type ApkgZipInput = Uint8Array | NodeJS.ReadableStream;

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|bmp|tiff?|avif)$/i;
const CLOZE_MARKER = /\{\{c\d+::/;
const FIELD_SEPARATOR = "\u001f";

function isZstd(bytes: Uint8Array): boolean {
  return ZSTD_MAGIC.every((b, i) => bytes[i] === b);
}

export function maybeDecompress(bytes: Uint8Array): Uint8Array {
  if (isZstd(bytes)) {
    try {
      return zstdDecompress(bytes);
    } catch {
      return bytes;
    }
  }
  return bytes;
}

/** True for the image media we actually import (audio/video are skipped). */
export function isImageMediaFilename(filename: string): boolean {
  return IMAGE_EXT.test(filename);
}

function tableExists(db: Database, name: string): boolean {
  const res = db.exec(
    `select 1 from sqlite_master where type='table' and name='${name}' limit 1`,
  );
  return res.length > 0 && res[0].values.length > 0;
}

function queryRows(db: Database, sql: string): Array<Record<string, SqlValue>> {
  let result;
  try {
    result = db.exec(sql);
  } catch {
    return [];
  }
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, SqlValue> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

function asString(value: SqlValue | undefined): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: SqlValue | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function asBytes(value: SqlValue | undefined): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

/** Locate and decompress the SQLite collection inside the .apkg archive. */
async function loadCollection(zip: JSZip): Promise<Uint8Array> {
  // Prefer the newest format, fall back to older ones.
  const candidates = ["collection.anki21b", "collection.anki21", "collection.anki2"];
  for (const name of candidates) {
    const file = zip.file(name);
    if (file) {
      const bytes = await file.async("uint8array");
      return maybeDecompress(bytes);
    }
  }
  throw new Error("No Anki collection found in package (expected collection.anki2/anki21).");
}

interface DeckMeta {
  name: string;
  configId?: number;
}

function readDecks(db: Database, newSchema: boolean, col: Record<string, SqlValue>): Map<string, DeckMeta> {
  const decks = new Map<string, DeckMeta>();
  if (newSchema) {
    for (const row of queryRows(db, "select id, name, kind from decks")) {
      const kind = asBytes(row.kind);
      decks.set(asString(row.id), {
        name: asString(row.name),
        configId: kind ? extractDeckConfigId(kind) : undefined,
      });
    }
    return decks;
  }
  // Legacy: decks live as JSON on the col row.
  try {
    const json = JSON.parse(asString(col.decks)) as Record<string, { name?: string; conf?: number }>;
    for (const [id, deck] of Object.entries(json)) {
      decks.set(id, { name: deck.name ?? "Imported deck", configId: deck.conf });
    }
  } catch {
    // ignore
  }
  return decks;
}

function readPresets(
  db: Database,
  newSchema: boolean,
  fsrsParamCount: number,
): Map<number, AnkiDeckPreset> {
  const presets = new Map<number, AnkiDeckPreset>();
  if (!newSchema || !tableExists(db, "deck_config")) return presets;
  for (const row of queryRows(db, "select id, config from deck_config")) {
    const config = asBytes(row.config);
    if (!config) continue;
    const preset = extractDeckPreset(config, fsrsParamCount);
    if (preset.fsrsParams || preset.desiredRetention != null) {
      presets.set(asNumber(row.id), preset);
    }
  }
  return presets;
}

function parseTags(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Anki tags use `::` for hierarchy; keep the full path but trim whitespace. */
function normalizeTag(tag: string): string {
  return tag.replace(/\u001f/g, "").trim();
}

interface NoteRow {
  fields: string[];
  tags: string[];
}

function readNotes(db: Database): Map<string, NoteRow> {
  const notes = new Map<string, NoteRow>();
  for (const row of queryRows(db, "select id, flds, tags from notes")) {
    notes.set(asString(row.id), {
      fields: asString(row.flds).split(FIELD_SEPARATOR),
      tags: parseTags(asString(row.tags)).map(normalizeTag).filter(Boolean),
    });
  }
  return notes;
}

interface CardRow {
  nid: string;
  did: string;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  data: string | null;
  id: number;
}

function readCards(db: Database): CardRow[] {
  return queryRows(
    db,
    "select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, data from cards",
  ).map((row) => ({
    id: asNumber(row.id),
    nid: asString(row.nid),
    did: asString(row.did),
    ord: asNumber(row.ord),
    type: asNumber(row.type),
    queue: asNumber(row.queue),
    due: asNumber(row.due),
    ivl: asNumber(row.ivl),
    factor: asNumber(row.factor),
    reps: asNumber(row.reps),
    lapses: asNumber(row.lapses),
    data: row.data == null ? null : asString(row.data),
  }));
}

/**
 * Build an index -> filename map from the package's `media` manifest, handling
 * both the legacy JSON format and the modern protobuf `MediaEntries` format.
 */
/**
 * Build an index -> filename map from raw `media` manifest bytes, handling both
 * the legacy JSON format and the modern protobuf `MediaEntries` format. Exposed
 * so non-JSZip readers (e.g. the streaming worker) can reuse manifest parsing.
 */
export function parseMediaManifestBytes(rawInput: Uint8Array): Record<string, string> {
  const raw = maybeDecompress(rawInput);
  // Legacy format: JSON object of { "0": "filename.jpg", ... }.
  try {
    const text = new TextDecoder().decode(raw).trim();
    if (text.startsWith("{")) {
      return JSON.parse(text) as Record<string, string>;
    }
  } catch {
    // fall through to protobuf
  }
  // Modern format: protobuf, entry order maps to zip files "0", "1", ...
  const manifest: Record<string, string> = {};
  parseMediaEntries(raw).forEach((name, index) => {
    if (name) manifest[String(index)] = name;
  });
  return manifest;
}

async function readMediaManifest(mapFile: JSZip.JSZipObject): Promise<Record<string, string>> {
  return parseMediaManifestBytes(await mapFile.async("uint8array"));
}

async function readMedia(zip: JSZip): Promise<Map<string, Uint8Array>> {
  const media = new Map<string, Uint8Array>();
  const mapFile = zip.file("media");
  if (!mapFile) return media;

  const manifest = await readMediaManifest(mapFile);

  for (const [index, filename] of Object.entries(manifest)) {
    if (!IMAGE_EXT.test(filename)) continue;
    const entry = zip.file(index);
    if (!entry) continue;
    const bytes = maybeDecompress(await entry.async("uint8array"));
    media.set(filename, bytes);
  }
  return media;
}

/** Read one image from an opened .apkg zip (for lazy imports of large decks). */
export async function readApkgMediaFile(
  zip: JSZip,
  filename: string,
): Promise<Uint8Array | null> {
  if (!IMAGE_EXT.test(filename)) return null;
  const mapFile = zip.file("media");
  if (!mapFile) return null;

  const manifest = await readMediaManifest(mapFile);
  const index = Object.entries(manifest).find(([, name]) => name === filename)?.[0];
  if (index == null) return null;

  const entry = zip.file(index);
  if (!entry) return null;
  return maybeDecompress(await entry.async("uint8array"));
}

export async function parseApkg(
  input: ApkgZipInput,
  options: ParseApkgOptions,
): Promise<ParsedApkg> {
  const zip = await JSZip.loadAsync(input);
  return parseApkgFromZip(zip, options);
}

export async function parseApkgFromZip(
  zip: JSZip,
  options: ParseApkgOptions,
): Promise<ParsedApkg> {
  const collectionBytes = await loadCollection(zip);
  const { decks, stats } = await parseApkgCollectionBytes(collectionBytes, options);
  const media = options.eagerMedia === false ? new Map<string, Uint8Array>() : await readMedia(zip);
  return { decks, media, stats: { ...stats, mediaCount: media.size } };
}

/** Decks + stats produced from a decompressed `collection.anki2*` SQLite blob. */
export type ParsedCollection = {
  decks: ImportedDeck[];
  stats: Omit<ParsedApkg["stats"], "mediaCount">;
};

/**
 * Parse the cards/decks/presets out of a decompressed SQLite collection blob.
 * Media is handled separately so large packages can stream it lazily without
 * ever loading the whole archive into memory. The `revlog` table is never read.
 */
export async function parseApkgCollectionBytes(
  collectionBytes: Uint8Array,
  options: ParseApkgOptions,
): Promise<ParsedCollection> {
  const SQL = await getSql();
  const db = new SQL.Database(collectionBytes);

  try {
    const colRows = queryRows(db, "select crt, decks, models, dconf, conf from col limit 1");
    const col = colRows[0] ?? {};
    const crtSeconds = asNumber(col.crt) || Math.floor(Date.now() / 1000);

    const newSchema = tableExists(db, "decks");
    const deckMeta = readDecks(db, newSchema, col);
    const presets = readPresets(db, newSchema, options.fsrsParamCount);
    const notes = readNotes(db);
    const cards = readCards(db);

    const now = new Date();

    // Group cards by note so cloze notes collapse into a single DeepHaus card.
    const cardsByNote = new Map<string, CardRow[]>();
    for (const card of cards) {
      const list = cardsByNote.get(card.nid);
      if (list) list.push(card);
      else cardsByNote.set(card.nid, [card]);
    }

    const deckCards = new Map<string, ImportedCard[]>();
    let noteCount = 0;
    let cardCount = 0;
    let scheduledCount = 0;
    let suspendedCount = 0;

    const pushCard = (deckId: string, card: ImportedCard) => {
      const list = deckCards.get(deckId);
      if (list) list.push(card);
      else deckCards.set(deckId, [card]);
    };

    for (const [nid, noteCardRows] of cardsByNote) {
      const note = notes.get(nid);
      if (!note) continue;
      noteCount += 1;
      const sorted = [...noteCardRows].sort((a, b) => a.ord - b.ord || a.id - b.id);

      // Down-convert every field once (HTML -> text, images preserved, cloze
      // markers survive). Detect cloze on the converted text so any note type
      // with `{{cN::}}` becomes a cloze card and everything else a basic card.
      const fieldTexts = note.fields.map((f) => ankiFieldToText(f));
      const clozeIndexes: number[] = [];
      fieldTexts.forEach((text, i) => {
        if (CLOZE_MARKER.test(text)) clozeIndexes.push(i);
      });

      if (clozeIndexes.length > 0) {
        // Cloze field(s) -> cloze text (front); every other field -> extra (back).
        const clozeText = clozeIndexes
          .map((i) => fieldTexts[i])
          .filter(Boolean)
          .join("\n\n");
        if (!clozeText) continue;
        const extra = fieldTexts
          .filter((text, i) => text && !clozeIndexes.includes(i))
          .join("\n\n");

        const reviews: ImportedReview[] = [];
        const seenOrd = new Set<number>();
        for (const c of sorted) {
          const clozeOrd = c.ord + 1;
          if (seenOrd.has(clozeOrd)) continue;
          seenOrd.add(clozeOrd);
          const fields = ankiCardToFsrs(c, crtSeconds, now);
          if (fields) {
            reviews.push({ clozeOrd, fields });
            scheduledCount += 1;
            if (fields.suspended) suspendedCount += 1;
          }
        }

        pushCard(sorted[0].did, {
          type: "cloze",
          front: null,
          back: null,
          clozeText,
          extra: extra || null,
          tags: note.tags,
          sortOrder: sorted[0].id,
          reviews,
        });
        cardCount += 1;
      } else {
        // Basic: first non-empty field -> front, second -> back, the rest -> extra.
        // Collapse multi-template notes into one card, keeping the primary
        // card's schedule (DeepHaus has no reversed-card concept).
        const nonEmpty = fieldTexts.filter(Boolean);
        const front = nonEmpty[0] ?? "";
        if (!front) continue;
        const back = nonEmpty[1] ?? "";
        const extra = nonEmpty.slice(2).join("\n\n");

        const primary = sorted[0];
        const fields = ankiCardToFsrs(primary, crtSeconds, now);
        const reviews: ImportedReview[] = [];
        if (fields) {
          reviews.push({ clozeOrd: 0, fields });
          scheduledCount += 1;
          if (fields.suspended) suspendedCount += 1;
        }

        pushCard(primary.did, {
          type: "basic",
          front,
          back: back || null,
          clozeText: null,
          extra: extra || null,
          tags: note.tags,
          sortOrder: primary.id,
          reviews,
        });
        cardCount += 1;
      }
    }

    // Pick a fallback preset (the first deck_config carrying FSRS weights) for
    // decks we couldn't map precisely.
    const fallbackPreset = [...presets.values()].find((p) => p.fsrsParams) ?? undefined;

    const decks: ImportedDeck[] = [];
    let fsrsPresetCount = 0;
    for (const [deckId, importedCards] of deckCards) {
      if (importedCards.length === 0) continue;
      importedCards.sort((a, b) => a.sortOrder - b.sortOrder);
      importedCards.forEach((card, index) => {
        card.sortOrder = index;
      });

      const meta = deckMeta.get(deckId);
      const preset =
        (meta?.configId != null ? presets.get(meta.configId) : undefined) ?? fallbackPreset;
      if (preset?.fsrsParams) fsrsPresetCount += 1;

      decks.push({
        ankiDeckId: deckId,
        name: meta?.name?.trim() || "Imported deck",
        preset,
        cards: importedCards,
      });
    }

    decks.sort((a, b) => a.name.localeCompare(b.name));

    return {
      decks,
      stats: {
        deckCount: decks.length,
        noteCount,
        cardCount,
        scheduledCount,
        suspendedCount,
        fsrsPresetCount,
      },
    };
  } finally {
    db.close();
  }
}
