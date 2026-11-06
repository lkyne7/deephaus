import {
  CardQuestionIndex,
  MAX_CARDS_PER_JOB,
  cardQuestionKey,
  isTopicSource,
  parseGenerationSettings,
  topicQueryFromSource,
  type GeneratedCard,
  type SourceType,
} from "@deephaus/shared";
import { generateCardsFromChunks, generateCardsFromTopic, createMockCards } from "@deephaus/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  releaseAiCredits,
  settleAiCredits,
} from "@/lib/credits/service";
import {
  buildSourceChunks,
  buildGenerationChunks,
  filterChunksByIndices,
} from "@/lib/sources/chunks";
import {
  ensureSourceChunks,
  type PersistedChunk,
} from "@/lib/sources/source-chunks";
import { createServiceClient } from "@/lib/supabase/server";

const USE_MOCK_LLM = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

/** Optional override for the generation model; falls back to the package default. */
const GENERATION_MODEL = process.env.OPENAI_GENERATION_MODEL?.trim() || undefined;

/** Uniform row shape for generated text cards. */
export type CardRow = {
  job_id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: null;
  tags: string[];
  sort_order: number;
  source_chunk_id: string | null;
  source_ref: string | null;
  source_quote: string | null;
};

/** Sort-order slots per chunk, so chunks that finish out of order still read in source order. */
const SORT_SLOTS_PER_CHUNK = 256;
/** Existing questions read per run, newest first. */
const MAX_EXISTING_QUESTIONS = 5000;
/** Existing questions shown to the model for one chunk, and how much of each. */
const MAX_AVOID_QUESTIONS_PER_CHUNK = 40;
const MAX_AVOID_QUESTION_CHARS = 160;

export function textCardMixLabel(cardTypes: ("basic" | "cloze")[]): string {
  if (cardTypes.length === 0) return "card";
  return cardTypes
    .map((t) => (t === "cloze" ? "fill-in-the-blank (cloze)" : "front/back (basic)"))
    .join(" or ");
}

/** Lowest sort_order in a deck, or null when the deck has no cards yet. */
export async function deckMinSortOrder(
  supabase: SupabaseClient,
  projectId: string,
  excludeJobId?: string,
): Promise<number | null> {
  let query = supabase
    .from("cards")
    .select("sort_order, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", projectId);
  if (excludeJobId) query = query.neq("job_id", excludeJobId);
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.sort_order;
}

/**
 * Sort order for a card saved as its chunk finishes: the whole run lands before
 * the deck's existing cards, in source order, whichever chunk completes first.
 */
export function chunkSortOrder(
  existingMin: number | null,
  chunkPosition: number,
  chunkCount: number,
  cardPosition: number,
): number {
  const start = (existingMin ?? 0) - chunkCount * SORT_SLOTS_PER_CHUNK;
  return (
    start + chunkPosition * SORT_SLOTS_PER_CHUNK + Math.min(cardPosition, SORT_SLOTS_PER_CHUNK - 1)
  );
}

/** Plain-text question for the "already in this deck" prompt list. */
function avoidQuestionText(card: {
  type: string;
  front?: string | null;
  cloze_text?: string | null;
}): string {
  return cardQuestionKey(card).replace(/<[^>]+>/g, " ").slice(0, MAX_AVOID_QUESTION_CHARS).trim();
}

/** What the deck already asks: an index to reject repeats, and questions per source chunk. */
export async function loadDeckQuestions(supabase: SupabaseClient, projectId: string) {
  const { data } = await supabase
    .from("cards")
    .select(
      "type, front, back, cloze_text, source_chunk_id, generation_jobs!inner(sources!inner(project_id))",
    )
    .eq("generation_jobs.sources.project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_EXISTING_QUESTIONS);

  const index = new CardQuestionIndex();
  const byChunkId = new Map<string, string[]>();
  for (const card of (data ?? []) as Array<{
    type: string;
    front: string | null;
    back: string | null;
    cloze_text: string | null;
    source_chunk_id: string | null;
  }>) {
    index.add(card);
    if (!card.source_chunk_id) continue;
    const questions = byChunkId.get(card.source_chunk_id) ?? [];
    if (questions.length < MAX_AVOID_QUESTIONS_PER_CHUNK) questions.push(avoidQuestionText(card));
    byChunkId.set(card.source_chunk_id, questions);
  }
  return { index, byChunkId };
}

/** Place a new batch before existing cards (lower sort_order = earlier in the queue). */
function prependSortOrders(rows: CardRow[], existingMin: number | null): CardRow[] {
  const start = existingMin === null ? 0 : existingMin - rows.length;
  return rows.map((row, index) => ({
    ...row,
    sort_order: start + index,
  }));
}

/** The chunk a highlighted selection belongs to, so its cards link back to the source. */
export function selectionChunk(
  sourceType: SourceType,
  text: string,
  scopeText: string,
  chunkById: ReadonlyMap<number, PersistedChunk>,
) {
  const needle = scopeText.slice(0, Math.min(120, scopeText.length));
  const allChunks = buildSourceChunks(sourceType, text || scopeText);
  const matchingBuilt =
    allChunks.find((chunk) => chunk.text.includes(needle)) ??
    allChunks.find((chunk) => needle.includes(chunk.text.slice(0, 80))) ??
    null;
  const matchingChunk =
    matchingBuilt != null ? chunkById.get(matchingBuilt.index) ?? null : null;
  return {
    matchingChunk,
    scopeChunk: {
      text: scopeText,
      sourceRef: matchingBuilt?.sourceRef ?? matchingChunk?.source_ref ?? "Selection::1",
      index: matchingBuilt?.index ?? matchingChunk?.chunk_index ?? 0,
    },
  };
}

/** A generated card as a `cards` row. */
export function generatedCardRow(
  card: GeneratedCard,
  sortOrder: number,
  context: {
    jobId: string;
    autoTags: boolean;
    isTopic: boolean;
    chunkById: ReadonlyMap<number, PersistedChunk>;
  },
): CardRow | null {
  if (card.type !== "basic" && card.type !== "cloze") return null;
  const linkedChunk =
    card.chunkIndex != null ? context.chunkById.get(card.chunkIndex) ?? null : null;
  return {
    job_id: context.jobId,
    type: card.type,
    front: card.type === "basic" ? (card.front ?? null) : null,
    back: card.type === "basic" ? (card.back ?? null) : null,
    cloze_text: card.type === "cloze" ? (card.clozeText ?? null) : null,
    extra: card.type === "cloze" ? (card.extra ?? null) : null,
    occlusion_data: null,
    // Hard guarantee: when auto-tags are off, drop tags even if the
    // model ignored the prompt instruction (also covers the mock path).
    tags: context.autoTags ? card.tags : [],
    sort_order: sortOrder,
    source_chunk_id: linkedChunk?.id ?? null,
    source_ref: card.sourceRef ?? linkedChunk?.source_ref ?? null,
    source_quote: context.isTopic ? null : (card.sourceQuote ?? null),
  };
}

export async function rollbackPersistedCards(
  supabase: SupabaseClient,
  jobId: string,
  settlementError: unknown,
): Promise<never> {
  // Card insertion uses the request-scoped client while credit settlement uses
  // the service client, so these writes cannot share a Postgres transaction.
  // Compensate immediately and fail loudly if the rollback itself is blocked.
  const { error: rollbackError } = await supabase
    .from("cards")
    .delete()
    .eq("job_id", jobId);
  if (rollbackError) {
    const service = createServiceClient();
    const { error: serviceRollbackError } = await service
      .from("cards")
      .delete()
      .eq("job_id", jobId);
    if (serviceRollbackError) {
      throw new Error(
        `Credit settlement failed and persisted cards could not be rolled back: ${serviceRollbackError.message}`,
        { cause: settlementError },
      );
    }
  }
  throw new Error(
    "Credit settlement failed after card persistence; inserted cards were rolled back.",
    { cause: settlementError },
  );
}

export async function processGenerationJob(
  jobId: string,
  supabase: SupabaseClient,
  options?: { chunkIndices?: number[]; scopeText?: string },
) {
  let terminal = false;
  let creditOwnerId: string | null = null;
  let creditIdempotencyKey: string | null = null;
  let hasCreditReservation = false;
  /** Cards already saved by this run, chunk by chunk. */
  const savedCards: Array<{ id: string; key: string }> = [];

  const updateJob = async (
    status: string,
    fields: Record<string, unknown> = {},
  ) => {
    if (terminal && status !== "failed" && status !== "ready") return;
    await supabase
      .from("generation_jobs")
      .update({ status, updated_at: new Date().toISOString(), ...fields })
      .eq("id", jobId);
  };

  try {
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .select("*, sources(*, projects(*))")
      .eq("id", jobId)
      .single();

    if (jobError || !job) throw new Error("Job not found");

    const source = job.sources;
    const project = source.projects;
    creditOwnerId = project.user_id as string;
    creditIdempotencyKey = `generation:${jobId}`;
    hasCreditReservation = Boolean(job.credit_transaction_id);
    const settings = parseGenerationSettings(
      project.settings ?? {
        cardMix: "basic",
        detailLevel: "medium",
      },
    );

    const sourceType = source.type as SourceType;
    const isTopic = isTopicSource(source);
    const scopeText = options?.scopeText?.trim() || "";

    let stopRequested = false;
    /** Stop requests arrive on the job row; a failed read just means keep going. */
    const isStopRequested = async () => {
      if (stopRequested) return true;
      const { data } = await supabase
        .from("generation_jobs")
        .select("cancel_requested_at")
        .eq("id", jobId)
        .maybeSingle();
      stopRequested = Boolean(data?.cancel_requested_at);
      return stopRequested;
    };

    await updateJob("chunking", { progress: 10 });

    // Persist (and embed) source chunks so every generated card can link back to
    // the exact segment it came from. Idempotent; skipped for topic sources.
    let persistedChunks: PersistedChunk[] = [];
    const chunkById = new Map<number, PersistedChunk>();
    if (!isTopic) {
      persistedChunks = await ensureSourceChunks(supabase, {
        id: source.id,
        type: sourceType,
        raw_text: source.raw_text ?? null,
      });
      for (const chunk of persistedChunks) chunkById.set(chunk.chunk_index, chunk);
    }

    const deckQuestions = await loadDeckQuestions(supabase, project.id);
    const existingMin = await deckMinSortOrder(supabase, project.id);
    let repeatsSkipped = 0;

    /** Reject a question the deck, or this run, already has. */
    const isRepeat = (card: GeneratedCard) => {
      if (deckQuestions.index.has(card)) {
        repeatsSkipped += 1;
        return true;
      }
      deckQuestions.index.add(card);
      return false;
    };

    const toCardRow = (card: GeneratedCard, sortOrder: number) =>
      generatedCardRow(card, sortOrder, {
        jobId,
        autoTags: settings.autoTags,
        isTopic,
        chunkById,
      });

    // ----- Text cards (front/back and/or cloze) --------------------------------
    const textRows: CardRow[] = [];
    let tokenUsage = 0;
    let generationDetail: string | undefined;

    {
      const text = isTopic ? topicQueryFromSource(source) : (source.raw_text ?? "");
      if (!scopeText && !text.trim()) {
        throw new Error(
          isTopic
            ? "No topic available for generation."
            : "No text available for generation. The source may be empty or unsupported.",
        );
      }

      await updateJob("generating", { progress: 30 });

      let cards: GeneratedCard[];
      const textProgressSpan = 60;

      if (isTopic) {
        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
          const sourceRef = `Topic::${text.slice(0, 40)}`;
          cards = settings.cardTypes.flatMap((type) => createMockCards(sourceRef, type));
        } else {
          const result = await generateCardsFromTopic(text, settings, {
            apiKey: process.env.OPENAI_API_KEY!,
            model: GENERATION_MODEL,
          });
          cards = result.cards;
          tokenUsage = result.tokenUsage;
          generationDetail = result.detail;
          void updateJob("generating", { progress: 30 + textProgressSpan });
        }
      } else if (scopeText) {
        if (scopeText.length < 20) {
          throw new Error(
            "Highlighted text is too short to generate useful flashcards (minimum 20 characters).",
          );
        }
        const { matchingChunk, scopeChunk } = selectionChunk(
          sourceType,
          text,
          scopeText,
          chunkById,
        );

        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
          const mockQuote = scopeText.slice(0, 160);
          cards = settings.cardTypes
            .flatMap((type) => createMockCards(scopeChunk.sourceRef, type))
            .map((c) => ({
              ...c,
              sourceRef: scopeChunk.sourceRef,
              chunkIndex: scopeChunk.index,
              sourceQuote: mockQuote,
            }));
        } else {
          const result = await generateCardsFromChunks(
            [scopeChunk],
            settings,
            { apiKey: process.env.OPENAI_API_KEY!, model: GENERATION_MODEL },
            (completed, total) => {
              if (terminal) return;
              const progress = 30 + Math.round((completed / total) * textProgressSpan);
              void updateJob("generating", { progress });
            },
          );
          cards = result.cards;
          tokenUsage = result.tokenUsage;
          generationDetail = result.detail;
        }

        for (let index = 0; index < cards.length; index += 1) {
          const card = cards[index];
          if (card.type !== "basic" && card.type !== "cloze") continue;
          if (isRepeat(card)) continue;
          textRows.push({
            job_id: jobId,
            type: card.type,
            front: card.type === "basic" ? (card.front ?? null) : null,
            back: card.type === "basic" ? (card.back ?? null) : null,
            cloze_text: card.type === "cloze" ? (card.clozeText ?? null) : null,
            extra: card.type === "cloze" ? (card.extra ?? null) : null,
            occlusion_data: null,
            tags: settings.autoTags ? card.tags : [],
            sort_order: index,
            source_chunk_id: matchingChunk?.id ?? null,
            source_ref: card.sourceRef ?? matchingChunk?.source_ref ?? "Selection::1",
            source_quote: card.sourceQuote ?? scopeText.slice(0, 240),
          });
        }
      } else {
        const allChunks = buildGenerationChunks(sourceType, text);
        const chunks = filterChunksByIndices(allChunks, options?.chunkIndices);
        if (chunks.length === 0) throw new Error("Could not chunk source text.");

        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
          const sourceRef = chunks[0]?.sourceRef ?? "Notes";
          const firstIndex = chunks[0]?.index ?? 0;
          // Mock quotes: a verbatim slice of the chunk so source highlights work in dev.
          const mockQuote = chunks[0]?.text?.trim().slice(0, 160) || undefined;
          cards = settings.cardTypes
            .flatMap((type) => createMockCards(sourceRef, type))
            .map((c) => ({ ...c, sourceRef, chunkIndex: firstIndex, sourceQuote: mockQuote }));
        } else {
          const chunkPosition = new Map(chunks.map((chunk, position) => [chunk.index, position]));
          const avoidByChunk = new Map<number, string[]>();
          for (const chunk of chunks) {
            const persisted = chunkById.get(chunk.index);
            const questions = persisted ? deckQuestions.byChunkId.get(persisted.id) : undefined;
            if (questions?.length) avoidByChunk.set(chunk.index, questions);
          }

          const result = await generateCardsFromChunks(
            chunks,
            settings,
            { apiKey: process.env.OPENAI_API_KEY!, model: GENERATION_MODEL },
            (completed, total) => {
              if (terminal) return;
              const progress = 30 + Math.round((completed / total) * textProgressSpan);
              void updateJob("generating", { progress });
            },
            {
              avoidByChunk,
              shouldStop: isStopRequested,
              // Save each chunk as it finishes so cards reach the learner during the run.
              onChunkCards: async (chunkIndex, chunkCards) => {
                if (await isStopRequested()) return;
                const position = chunkPosition.get(chunkIndex) ?? 0;
                const rows = chunkCards
                  .filter((card) => !isRepeat(card))
                  .map((card, cardPosition) =>
                    toCardRow(
                      card,
                      chunkSortOrder(existingMin, position, chunks.length, cardPosition),
                    ),
                  )
                  .filter((row): row is CardRow => row !== null);
                if (rows.length === 0) return;
                const { data: inserted, error: insertError } = await supabase
                  .from("cards")
                  .insert(rows)
                  .select("id, type, front, cloze_text");
                if (insertError) throw insertError;
                for (const row of inserted ?? []) {
                  savedCards.push({ id: row.id as string, key: cardQuestionKey(row) });
                }
              },
            },
          );
          // Chunks can overshoot the per-job cap; drop what the coverage selection left out.
          if (savedCards.length > MAX_CARDS_PER_JOB) {
            const kept = new Set(result.cards.map((card) => cardQuestionKey(card)));
            const dropped = savedCards.filter((card) => !kept.has(card.key));
            for (let i = 0; i < dropped.length; i += 200) {
              const { error: trimError } = await supabase
                .from("cards")
                .delete()
                .in("id", dropped.slice(i, i + 200).map((card) => card.id));
              if (trimError) throw trimError;
            }
            const droppedIds = new Set(dropped.map((card) => card.id));
            const remaining = savedCards.filter((card) => !droppedIds.has(card.id));
            savedCards.length = 0;
            savedCards.push(...remaining);
          }
          cards = [];
          tokenUsage = result.tokenUsage;
          generationDetail = result.detail;
        }
      }

      // Selection-scoped cards were already pushed above.
      if (!scopeText) {
        for (let index = 0; index < cards.length; index += 1) {
          const row = toCardRow(cards[index]!, index);
          if (row && !isRepeat(cards[index]!)) textRows.push(row);
        }
      }
    }

    // A stop that lands during a single model call drops that call's cards.
    const rows = (await isStopRequested()) ? [] : textRows;
    const rowsToInsert = prependSortOrders(rows, existingMin);
    const newCardCount = savedCards.length + rowsToInsert.length;

    if (newCardCount === 0 && !stopRequested && repeatsSkipped === 0) {
      const detail = generationDetail ? ` ${generationDetail}` : "";
      throw new Error(
        `No valid ${textCardMixLabel(settings.cardTypes)} cards were generated from this source.${detail}`,
      );
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase.from("cards").insert(rowsToInsert);
      if (insertError) throw insertError;
    }

    if (hasCreditReservation && creditOwnerId && creditIdempotencyKey) {
      try {
        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY || newCardCount === 0) {
          await releaseAiCredits({
            userId: creditOwnerId,
            idempotencyKey: creditIdempotencyKey,
          });
        } else {
          await settleAiCredits({
            userId: creditOwnerId,
            idempotencyKey: creditIdempotencyKey,
            chargedCredits: newCardCount,
          });
        }
      } catch (settlementError) {
        await rollbackPersistedCards(supabase, jobId, settlementError);
      }
    }

    terminal = true;
    await updateJob("ready", { progress: 100, token_usage: tokenUsage, error: null });
  } catch (error) {
    // Cards saved before the failure stay in the deck, so they're charged as usual.
    const keptCards = savedCards.length;
    if (hasCreditReservation && creditOwnerId && creditIdempotencyKey) {
      try {
        if (keptCards > 0) {
          await settleAiCredits({
            userId: creditOwnerId,
            idempotencyKey: creditIdempotencyKey,
            chargedCredits: keptCards,
          });
        } else {
          await releaseAiCredits({
            userId: creditOwnerId,
            idempotencyKey: creditIdempotencyKey,
          });
        }
      } catch (creditError) {
        console.error("[generation credits] failed to close reservation", creditError);
      }
    }
    terminal = true;
    const message = error instanceof Error ? error.message : "Generation failed";
    await updateJob("failed", {
      error:
        keptCards > 0
          ? `${message} ${keptCards} ${keptCards === 1 ? "card was" : "cards were"} saved before it stopped.`
          : message,
      progress: 100,
    });
  }
}
