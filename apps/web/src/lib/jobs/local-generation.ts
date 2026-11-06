import {
  CardQuestionIndex,
  MAX_CARDS_PER_JOB,
  deduplicateCards,
  isTopicSource,
  parseGenerationSettings,
  topicQueryFromSource,
  type GeneratedCard,
  type SourceType,
  type TextChunk,
} from "@deephaus/shared";
import {
  GENERATED_CARDS_JSON_SCHEMA,
  chunkCardPrompt,
  chunkGenerationPasses,
  parseChunkCards,
  parseCardsResponse,
  topicCardPrompt,
  topicGenerationPasses,
  type CardPrompt,
  type GenerateChunkOptions,
  type ParsedCards,
} from "@deephaus/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isJobTerminal } from "@/lib/jobs/limits";
import {
  chunkSortOrder,
  deckMinSortOrder,
  generatedCardRow,
  loadDeckQuestions,
  selectionChunk,
  textCardMixLabel,
  type CardRow,
} from "@/lib/jobs/processor";
import { buildGenerationChunks, filterChunksByIndices } from "@/lib/sources/chunks";
import { ensureSourceChunks, type PersistedChunk } from "@/lib/sources/source-chunks";

export type LocalStepInput = {
  /** The unit `outputs` answer, or the unit to fetch when there are none. */
  position: number;
  /** One model answer per request the previous step returned. */
  outputs?: string[];
  /** Repeats skipped so far, echoed back so an all-repeat run still counts as done. */
  repeats?: number;
  /** The desktop run failed; closes the job with this message. */
  error?: string;
};

export type LocalStepResult =
  | { done: true }
  | {
      done: false;
      position: number;
      total: number;
      repeats: number;
      requests: CardPrompt[];
      schema: Record<string, unknown>;
    };

export class LocalStepError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LocalStepError";
  }
}

/** One model call site: a topic, a highlighted selection, or a source chunk. */
type Plan = {
  total: number;
  passes: GenerateChunkOptions[];
  prompt: (position: number, pass: GenerateChunkOptions) => CardPrompt;
  parse: (position: number, output: string, pass: GenerateChunkOptions) => ParsedCards;
  /** Selection cards fall back to the highlighted text as their quote. */
  finishRow?: (row: CardRow) => CardRow;
};

function buildPlan(input: {
  sourceType: SourceType;
  text: string;
  isTopic: boolean;
  scopeText: string;
  chunkIndices?: number[];
  settings: ReturnType<typeof parseGenerationSettings>;
  chunkById: ReadonlyMap<number, PersistedChunk>;
  avoidFor: (chunk: TextChunk) => string[] | undefined;
}): Plan {
  const { settings, text } = input;

  if (input.isTopic) {
    if (!text.trim()) throw new Error("No topic available for generation.");
    return {
      total: 1,
      passes: topicGenerationPasses(settings),
      prompt: (_position, pass) => topicCardPrompt(text, settings, pass),
      parse: (_position, output, pass) => parseCardsResponse(output, settings, pass),
    };
  }

  if (input.scopeText) {
    const { matchingChunk, scopeChunk } = selectionChunk(
      input.sourceType,
      text,
      input.scopeText,
      input.chunkById,
    );
    return {
      total: 1,
      passes: chunkGenerationPasses([scopeChunk], settings),
      prompt: (_position, pass) => chunkCardPrompt(scopeChunk, settings, pass),
      parse: (_position, output, pass) => parseChunkCards(output, scopeChunk, settings, pass),
      finishRow: (row) => ({
        ...row,
        source_chunk_id: matchingChunk?.id ?? null,
        source_quote: row.source_quote ?? input.scopeText.slice(0, 240),
      }),
    };
  }

  if (!text.trim()) {
    throw new Error("No text available for generation. The source may be empty or unsupported.");
  }
  const chunks = filterChunksByIndices(
    buildGenerationChunks(input.sourceType, text),
    input.chunkIndices,
  );
  if (chunks.length === 0) throw new Error("Could not chunk source text.");
  return {
    total: chunks.length,
    passes: chunkGenerationPasses(chunks, settings),
    prompt: (position, pass) =>
      chunkCardPrompt(chunks[position]!, settings, {
        ...pass,
        avoid: input.avoidFor(chunks[position]!),
      }),
    parse: (position, output, pass) => parseChunkCards(output, chunks[position]!, settings, pass),
  };
}

async function jobCardCount(supabase: SupabaseClient, jobId: string): Promise<number> {
  const { count } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  return count ?? 0;
}

/**
 * Advance a job the desktop app is running on the user's own plan. The server
 * still owns prompts, validation, dedupe, and saving; only the model call moves
 * to the user's machine. Replaying a step is safe because repeats are skipped.
 */
export async function runLocalGenerationStep(
  supabase: SupabaseClient,
  jobId: string,
  step: LocalStepInput,
): Promise<LocalStepResult> {
  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select("*, sources(*, projects(*))")
    .eq("id", jobId)
    .single();
  if (jobError || !job) throw new LocalStepError("Job not found", 404);
  if (!job.local_engine) throw new LocalStepError("This job runs on the server.", 409);
  if (isJobTerminal(job.status as string)) return { done: true };

  const updateJob = async (status: string, fields: Record<string, unknown>) => {
    await supabase
      .from("generation_jobs")
      .update({ status, updated_at: new Date().toISOString(), ...fields })
      .eq("id", jobId);
  };

  const failJob = async (message: string): Promise<LocalStepResult> => {
    const kept = await jobCardCount(supabase, jobId);
    await updateJob("failed", {
      progress: 100,
      error:
        kept > 0
          ? `${message} ${kept} ${kept === 1 ? "card was" : "cards were"} saved before it stopped.`
          : message,
    });
    return { done: true };
  };

  if (step.error) return failJob(step.error);

  const finishJob = async (): Promise<LocalStepResult> => {
    await updateJob("ready", { progress: 100, error: null });
    return { done: true };
  };

  // Stopping keeps the cards saved so far and drops whatever just arrived.
  if (job.cancel_requested_at) return finishJob();

  try {
    const source = job.sources;
    const project = source.projects;
    const settings = parseGenerationSettings(
      project.settings ?? { cardMix: "basic", detailLevel: "medium" },
    );
    const sourceType = source.type as SourceType;
    const isTopic = isTopicSource(source);
    const scope = (job.local_scope ?? {}) as { chunkIndices?: number[]; scopeText?: string };
    const scopeText = scope.scopeText?.trim() || "";

    if (step.position === 0 && !step.outputs) {
      await updateJob("chunking", { progress: 10 });
    }

    const chunkById = new Map<number, PersistedChunk>();
    if (!isTopic) {
      const persisted = await ensureSourceChunks(supabase, {
        id: source.id,
        type: sourceType,
        raw_text: source.raw_text ?? null,
      });
      for (const chunk of persisted) chunkById.set(chunk.chunk_index, chunk);
    }

    const deck: {
      index: CardQuestionIndex;
      byChunkId: Map<string, string[]>;
    } = await loadDeckQuestions(supabase, project.id);

    const plan = buildPlan({
      sourceType,
      text: isTopic ? topicQueryFromSource(source) : (source.raw_text ?? ""),
      isTopic,
      scopeText,
      chunkIndices: scope.chunkIndices,
      settings,
      chunkById,
      avoidFor: (chunk) => {
        const persisted = chunkById.get(chunk.index);
        return persisted ? deck.byChunkId.get(persisted.id) : undefined;
      },
    });

    if (step.position >= plan.total) throw new LocalStepError("Step is out of range.", 400);

    let repeats = step.repeats ?? 0;
    let saved = await jobCardCount(supabase, jobId);

    if (step.outputs) {
      if (step.outputs.length !== plan.passes.length) {
        throw new LocalStepError("Expected one answer per request.", 400);
      }
      const cards: GeneratedCard[] = step.outputs.flatMap(
        (output, pass) => plan.parse(step.position, output, plan.passes[pass]!).cards,
      );
      const existingMin = await deckMinSortOrder(supabase, project.id, jobId);
      const fresh = deduplicateCards(cards).filter((card) => {
        if (deck.index.has(card)) {
          repeats += 1;
          return false;
        }
        deck.index.add(card);
        return true;
      });
      // The client reports model output, so the per-job cap is enforced here.
      const rows = fresh
        .slice(0, Math.max(0, MAX_CARDS_PER_JOB - saved))
        .map((card, cardPosition) =>
          generatedCardRow(
            card,
            chunkSortOrder(existingMin, step.position, plan.total, cardPosition),
            { jobId, autoTags: settings.autoTags, isTopic, chunkById },
          ),
        )
        .filter((row): row is CardRow => row !== null)
        .map((row) => plan.finishRow?.(row) ?? row);
      if (rows.length > 0) {
        const { error: insertError } = await supabase.from("cards").insert(rows);
        if (insertError) throw insertError;
        saved += rows.length;
      }
    }

    const position = step.outputs ? step.position + 1 : step.position;
    if (position >= plan.total || saved >= MAX_CARDS_PER_JOB) {
      if (saved > 0 || repeats > 0) return finishJob();
      return failJob(`No valid ${textCardMixLabel(settings.cardTypes)} cards were generated from this source.`);
    }

    await updateJob("generating", {
      progress: 30 + Math.round((position / plan.total) * 60),
    });
    return {
      done: false,
      position,
      total: plan.total,
      repeats,
      requests: plan.passes.map((pass) => plan.prompt(position, pass)),
      schema: GENERATED_CARDS_JSON_SCHEMA,
    };
  } catch (error) {
    if (error instanceof LocalStepError) throw error;
    return failJob(error instanceof Error ? error.message : "Generation failed");
  }
}
