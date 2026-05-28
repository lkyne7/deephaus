import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  rewriteMediaRefs,
  extractMediaFilenames,
  type ImportedCard,
  type ImportedDeck,
  type ParsedApkg,
} from "@deephaus/apkg";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  parseGenerationSettings,
} from "@deephaus/shared";

export interface AnkiImportResult {
  decks: Array<{ id: string; name: string; cardCount: number }>;
  cardsImported: number;
  scheduledImported: number;
  suspendedImported: number;
  mediaImported: number;
  mediaSkipped: number;
  fsrsPresetsApplied: number;
}

export interface AnkiImportOptions {
  /** Merge every Anki deck into one new deck with this name. */
  deckNameOverride?: string;
  /**
   * Import per-card scheduling state and the deck's FSRS preset. When false,
   * cards come in as fresh "new" cards with default scheduling.
   */
  importScheduling?: boolean;
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const CARD_INSERT_CHUNK = 500;

function contentTypeFor(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? MEDIA_CONTENT_TYPES[ext] ?? null : null;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Filenames actually referenced by any card field across all decks. */
function referencedMedia(decks: ImportedDeck[]): Set<string> {
  const refs = new Set<string>();
  for (const deck of decks) {
    for (const card of deck.cards) {
      for (const name of extractMediaFilenames(card.front, card.back, card.clozeText, card.extra)) {
        refs.add(name);
      }
    }
  }
  return refs;
}

/**
 * Upload referenced image media to the public card-media bucket and return a
 * filename -> hosted URL map. Files the bucket rejects are skipped (cards still
 * import; the broken ref is dropped on rewrite).
 */
async function uploadMedia(
  supabase: SupabaseClient,
  userId: string,
  parsed: ParsedApkg,
): Promise<{ map: Map<string, string>; imported: number; skipped: number }> {
  const refs = referencedMedia(parsed.decks);
  const map = new Map<string, string>();
  let imported = 0;
  let skipped = 0;

  for (const filename of refs) {
    const bytes = parsed.media.get(filename);
    const contentType = contentTypeFor(filename);
    if (!bytes || !contentType) {
      skipped += 1;
      continue;
    }
    const storagePath = `${userId}/anki/${randomUUID()}-${safeFileName(filename)}`;
    const { error } = await supabase.storage
      .from("card-media")
      .upload(storagePath, bytes, { contentType, upsert: false });
    if (error) {
      skipped += 1;
      continue;
    }
    const { data } = supabase.storage.from("card-media").getPublicUrl(storagePath);
    map.set(filename, data.publicUrl);
    imported += 1;
  }

  return { map, imported, skipped };
}

function deckSettings(deck: ImportedDeck, importScheduling: boolean) {
  return parseGenerationSettings({
    cardMix: "basic",
    detailLevel: "medium",
    desiredRetention: importScheduling
      ? deck.preset?.desiredRetention ?? DEFAULT_DESIRED_RETENTION
      : DEFAULT_DESIRED_RETENTION,
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
    fsrsParams: importScheduling ? deck.preset?.fsrsParams : undefined,
  });
}

interface CardInsert {
  job_id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  sort_order: number;
}

function rewriteCardField(value: string | null, mediaMap: Map<string, string>): string | null {
  if (!value) return value;
  const rewritten = rewriteMediaRefs(value, mediaMap).trim();
  return rewritten || null;
}

async function createDeck(
  supabase: SupabaseClient,
  userId: string,
  deck: ImportedDeck,
  mediaMap: Map<string, string>,
  importScheduling: boolean,
): Promise<{ id: string; name: string; cardCount: number; scheduled: number; suspended: number }> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: deck.name,
      deck_name: deck.name,
      settings: deckSettings(deck, importScheduling),
    })
    .select("id")
    .single();
  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to create deck");
  }

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .insert({ project_id: project.id, type: "apkg", raw_text: "Imported from Anki (.apkg)" })
    .select("id")
    .single();
  if (sourceError || !source) {
    throw new Error(sourceError?.message ?? "Failed to create source");
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({ source_id: source.id, status: "ready", progress: 100 })
    .select("id")
    .single();
  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Failed to create generation job");
  }

  let cardCount = 0;
  let scheduled = 0;
  let suspended = 0;

  for (const batch of chunk(deck.cards, CARD_INSERT_CHUNK)) {
    const rows: CardInsert[] = batch.map((card) => ({
      job_id: job.id,
      type: card.type,
      front: rewriteCardField(card.front, mediaMap),
      back: rewriteCardField(card.back, mediaMap),
      cloze_text: rewriteCardField(card.clozeText, mediaMap),
      extra: rewriteCardField(card.extra, mediaMap),
      tags: card.tags,
      sort_order: card.sortOrder,
    }));

    const { data: inserted, error: cardsError } = await supabase
      .from("cards")
      .insert(rows)
      .select("id");
    if (cardsError || !inserted) {
      throw new Error(cardsError?.message ?? "Failed to insert cards");
    }
    cardCount += inserted.length;

    if (!importScheduling) continue;

    // PostgREST returns rows in insertion order, so ids line up with `batch`.
    const reviewRows = buildReviewRows(batch, inserted, userId);
    scheduled += reviewRows.length;
    suspended += reviewRows.filter((r) => r.suspended).length;

    for (const reviewBatch of chunk(reviewRows, CARD_INSERT_CHUNK)) {
      if (reviewBatch.length === 0) continue;
      const { error: reviewError } = await supabase.from("card_reviews").insert(reviewBatch);
      if (reviewError) throw new Error(reviewError.message);
    }
  }

  return { id: project.id, name: deck.name, cardCount, scheduled, suspended };
}

function buildReviewRows(
  cards: ImportedCard[],
  inserted: Array<{ id: string }>,
  userId: string,
) {
  const rows: Array<{
    card_id: string;
    user_id: string;
    cloze_ord: number;
    suspended: boolean;
  } & Record<string, unknown>> = [];

  cards.forEach((card, i) => {
    const cardId = inserted[i]?.id;
    if (!cardId) return;
    for (const review of card.reviews) {
      rows.push({
        card_id: cardId,
        user_id: userId,
        cloze_ord: review.clozeOrd,
        due: review.fields.due,
        stability: review.fields.stability,
        difficulty: review.fields.difficulty,
        elapsed_days: review.fields.elapsed_days,
        scheduled_days: review.fields.scheduled_days,
        reps: review.fields.reps,
        lapses: review.fields.lapses,
        state: review.fields.state,
        last_review: review.fields.last_review,
        learning_steps: review.fields.learning_steps,
        suspended: review.fields.suspended,
      });
    }
  });

  return rows;
}

/** Merge every parsed Anki deck into a single deck for import. */
function mergeDecks(parsed: ParsedApkg, name: string): ImportedDeck {
  const cards = parsed.decks.flatMap((d) => d.cards);
  cards.forEach((card, index) => {
    card.sortOrder = index;
  });
  // Use the preset from the deck contributing the most cards.
  const richest = [...parsed.decks].sort((a, b) => b.cards.length - a.cards.length)[0];
  return { ankiDeckId: "merged", name, preset: richest?.preset, cards };
}

export async function importAnkiPackage(
  supabase: SupabaseClient,
  userId: string,
  parsed: ParsedApkg,
  options: AnkiImportOptions = {},
): Promise<AnkiImportResult> {
  const { map: mediaMap, imported: mediaImported, skipped: mediaSkipped } = await uploadMedia(
    supabase,
    userId,
    parsed,
  );

  const importScheduling = options.importScheduling ?? true;

  const targetDecks = options.deckNameOverride?.trim()
    ? [mergeDecks(parsed, options.deckNameOverride.trim())]
    : parsed.decks;

  const result: AnkiImportResult = {
    decks: [],
    cardsImported: 0,
    scheduledImported: 0,
    suspendedImported: 0,
    mediaImported,
    mediaSkipped,
    fsrsPresetsApplied: 0,
  };

  for (const deck of targetDecks) {
    if (deck.cards.length === 0) continue;
    const created = await createDeck(supabase, userId, deck, mediaMap, importScheduling);
    result.decks.push({ id: created.id, name: created.name, cardCount: created.cardCount });
    result.cardsImported += created.cardCount;
    result.scheduledImported += created.scheduled;
    result.suspendedImported += created.suspended;
    if (importScheduling && deck.preset?.fsrsParams) result.fsrsPresetsApplied += 1;
  }

  return result;
}
