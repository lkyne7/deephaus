import "server-only";
import {
  buildCardExplainState,
  cardContentHash,
  hintKey,
  rankSimilarCards,
  type CardExplainKind,
  type CardExplainState,
  type CardExplanationBody,
  type CardExplanationRow,
  type CardFieldFix,
  type ExplainThreadMessage,
} from "@deephaus/shared";
import type { TutorCandidate, TutorCardInput } from "@deephaus/llm";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads and writes for the study window's saved Hint/Explain results
 * (`card_explanations`), always under the signed-in user's session so RLS
 * applies.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface ExplainCard {
  id: string;
  job_id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  source_quote: string | null;
  sort_order: number | null;
  project_id: string;
  source: { id: string; title: string | null } | null;
}

export interface StoredExplanation extends CardExplanationRow {
  id: string;
  explanation: CardExplanationBody | null;
  hints: Record<string, string[]>;
  thread: ExplainThreadMessage[];
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function loadExplainCard(
  supabase: Supabase,
  userId: string,
  cardId: string,
): Promise<ExplainCard | null> {
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, job_id, type, front, back, cloze_text, extra, source_quote, sort_order, generation_jobs!inner(sources!inner(id, title, project_id, projects!inner(user_id)))",
    )
    .eq("id", cardId)
    .eq("generation_jobs.sources.projects.user_id", userId)
    .single();
  if (error || !data) return null;
  const job = one(data.generation_jobs as unknown);
  const source = one((job as { sources?: unknown } | null)?.sources) as
    | { id: string; title: string | null; project_id: string }
    | null;
  if (!source) return null;
  return {
    id: data.id,
    job_id: data.job_id,
    type: data.type,
    front: data.front,
    back: data.back,
    cloze_text: data.cloze_text,
    extra: data.extra,
    source_quote: data.source_quote,
    sort_order: data.sort_order,
    project_id: source.project_id,
    source: { id: source.id, title: source.title },
  };
}

export async function loadStoredExplanation(
  supabase: Supabase,
  userId: string,
  cardId: string,
): Promise<StoredExplanation | null> {
  const { data } = await supabase
    .from("card_explanations")
    .select("id, card_id, content_hash, explanation, hints, thread, updated_at")
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    ...data,
    hints: (data.hints as Record<string, string[]> | null) ?? {},
    thread: (data.thread as ExplainThreadMessage[] | null) ?? [],
  } as StoredExplanation;
}

export function tutorInput(card: ExplainCard): TutorCardInput {
  return {
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    source_quote: card.source_quote,
    source_title: card.source?.title ?? null,
  };
}

export function isStale(card: ExplainCard, row: StoredExplanation | null): boolean {
  return !!row && row.content_hash !== cardContentHash(card);
}

/** Cards from the same deck most worth comparing against, for "Don't confuse with". */
export async function loadCandidates(supabase: Supabase, card: ExplainCard): Promise<TutorCandidate[]> {
  const { data } = await supabase
    .from("cards")
    .select("id, type, front, back, cloze_text, extra, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", card.project_id)
    .neq("id", card.id)
    .limit(500);
  const others = (data ?? []).map((c) => ({
    id: c.id as string,
    type: c.type as TutorCandidate["type"],
    front: c.front as string | null,
    back: c.back as string | null,
    cloze_text: c.cloze_text as string | null,
    extra: c.extra as string | null,
  }));
  return rankSimilarCards(card, others, 15);
}

async function findCard(supabase: Supabase, id: string): Promise<CardExplainState["confusable"]> {
  const { data } = await supabase
    .from("cards")
    .select("id, type, front, back, cloze_text, extra")
    .eq("id", id)
    .maybeSingle();
  return (data as CardExplainState["confusable"]) ?? null;
}

export async function toState(
  supabase: Supabase,
  card: ExplainCard,
  row: StoredExplanation | null,
  options: { kind: CardExplainKind; clozeOrd?: number | null },
): Promise<CardExplainState> {
  const confusableId = options.kind === "explain" ? row?.explanation?.confusable?.card_id : null;
  const confusable = confusableId ? await findCard(supabase, confusableId) : null;
  return buildCardExplainState(row, { card, source: card.source, findCard: () => confusable }, options);
}

export type ExplanationPatch = {
  explanation?: CardExplanationBody | null;
  hints?: Record<string, string[]>;
  thread?: ExplainThreadMessage[];
  model?: string;
};

/**
 * Saves a result under the card's current hash. When the saved row was written
 * for an older version of the card, the parts not being rewritten are dropped
 * so nothing stale is shown as fresh.
 */
export async function saveExplanation(
  supabase: Supabase,
  userId: string,
  card: ExplainCard,
  row: StoredExplanation | null,
  patch: ExplanationPatch,
): Promise<StoredExplanation> {
  const keep = row && !isStale(card, row) ? row : null;
  const record = {
    card_id: card.id,
    user_id: userId,
    content_hash: cardContentHash(card),
    explanation: patch.explanation !== undefined ? patch.explanation : (keep?.explanation ?? null),
    hints: patch.hints ?? keep?.hints ?? {},
    thread: patch.thread ?? keep?.thread ?? [],
    model: patch.model ?? null,
  };
  const { data, error } = await supabase
    .from("card_explanations")
    .upsert(record, { onConflict: "card_id,user_id" })
    .select("id, card_id, content_hash, explanation, hints, thread, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the explanation.");
  return data as StoredExplanation;
}

export function mergeHints(
  card: ExplainCard,
  row: StoredExplanation | null,
  clozeOrd: number | null | undefined,
  hints: string[],
): Record<string, string[]> {
  const base = row && !isStale(card, row) ? row.hints : {};
  return { ...base, [hintKey(clozeOrd)]: hints };
}

/** Applies a suggested fix to the card and re-hashes the saved row so it stays fresh. */
export async function applyCardFix(
  supabase: Supabase,
  card: ExplainCard,
  fix: CardFieldFix,
): Promise<ExplainCard> {
  const allowed: CardFieldFix = {};
  const fields: Array<keyof CardFieldFix> =
    card.type === "cloze" ? ["cloze_text", "extra"] : card.type === "basic" ? ["front", "back", "extra"] : ["front", "back"];
  for (const key of fields) if (key in fix && typeof fix[key] === "string") allowed[key] = fix[key];
  if (Object.keys(allowed).length === 0) throw new Error("This suggestion has nothing to change.");
  const { data, error } = await supabase
    .from("cards")
    .update({ ...allowed, user_edited: true, updated_at: new Date().toISOString() })
    .eq("id", card.id)
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't update the card.");
  return { ...card, ...allowed };
}

/** Adds a suggested card to the same deck and source as the card being studied. */
export async function addSuggestedCard(
  supabase: Supabase,
  card: ExplainCard,
  front: string,
  back: string,
): Promise<{ id: string }> {
  const { data: edge } = await supabase
    .from("cards")
    .select("sort_order, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", card.project_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const edgeOrder = (edge as { sort_order?: number } | null)?.sort_order;
  const { data, error } = await supabase
    .from("cards")
    .insert({
      job_id: card.job_id,
      type: "basic",
      front,
      back,
      tags: [],
      sort_order: edgeOrder == null ? 0 : edgeOrder + 1,
      user_edited: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't add the card.");
  return { id: data.id as string };
}

export function tutorKeys() {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };
}

export function tutorIsMocked(): boolean {
  const keys = tutorKeys();
  return process.env.DEEPHAUS_USE_MOCK_LLM === "true" || (!keys.openaiApiKey && !keys.anthropicApiKey);
}
