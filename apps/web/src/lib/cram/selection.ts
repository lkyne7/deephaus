import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractClozeOrdinals,
  occlusionOrdinals,
  parseImageOcclusionData,
} from "@deephaus/shared";
import { default_w } from "ts-fsrs";
import { cardToRowFields, emptyCard, loadUserParams, resolveDeckParams } from "@/lib/fsrs/scheduler";
import { resolveDeckSettingsForProjects } from "@/lib/fsrs/settings";
import type {
  CramCardRow,
  CramPlanDeckProfileRow,
  CramPlanItemRow,
  CramSelectionSpec,
} from "@/lib/cram/types";

const CARD_SELECT = `
  id, source_chunk_id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order,
  generation_jobs!inner (
    sources!inner (
      id, project_id,
      projects!inner ( id, user_id )
    )
  )
`;

export type CramPlanItemInsert = Omit<
  CramPlanItemRow,
  "id" | "created_at" | "updated_at"
>;

export interface CramSnapshot {
  cards: CramCardRow[];
  items: CramPlanItemInsert[];
  profiles: CramPlanDeckProfileRow[];
}

export function normalizeSelectionSpec(spec: Partial<CramSelectionSpec>): CramSelectionSpec {
  return {
    deck_ids: uniqueStrings(spec.deck_ids),
    source_ids: uniqueStrings(spec.source_ids),
    chunk_ids: uniqueStrings(spec.chunk_ids),
    tags: uniqueStrings(spec.tags),
    card_ids: uniqueStrings(spec.card_ids),
  };
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function hasScopedFilters(spec: CramSelectionSpec): boolean {
  return (
    spec.deck_ids.length > 0 ||
    spec.source_ids.length > 0 ||
    spec.chunk_ids.length > 0 ||
    spec.tags.length > 0
  );
}

export async function resolveOwnedCramCards(
  supabase: SupabaseClient,
  userId: string,
  rawSpec: Partial<CramSelectionSpec>,
): Promise<CramCardRow[]> {
  const spec = normalizeSelectionSpec(rawSpec);
  const rows: unknown[] = [];

  if (hasScopedFilters(spec)) {
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      let query = supabase
        .from("cards")
        .select(CARD_SELECT)
        .eq("generation_jobs.sources.projects.user_id", userId)
        .order("id")
        .range(offset, offset + pageSize - 1);

      if (spec.deck_ids.length > 0) {
        query = query.in("generation_jobs.sources.project_id", spec.deck_ids);
      }
      if (spec.source_ids.length > 0) {
        query = query.in("generation_jobs.sources.id", spec.source_ids);
      }
      if (spec.chunk_ids.length > 0) {
        query = query.in("source_chunk_id", spec.chunk_ids);
      }
      if (spec.tags.length > 0) {
        query = query.overlaps("tags", spec.tags);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }
  }

  if (spec.card_ids.length > 0) {
    const { data, error } = await supabase
      .from("cards")
      .select(CARD_SELECT)
      .eq("generation_jobs.sources.projects.user_id", userId)
      .in("id", spec.card_ids);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }

  const cards = rows.flatMap(normalizeCardRow);
  return [...new Map(cards.map((card) => [card.id, card])).values()].sort((a, b) => {
    const project = a.project_id.localeCompare(b.project_id);
    if (project !== 0) return project;
    const order = a.sort_order - b.sort_order;
    return order !== 0 ? order : a.id.localeCompare(b.id);
  });
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function normalizeCardRow(raw: unknown): CramCardRow[] {
  const row = raw as {
    id?: string;
    source_chunk_id?: string | null;
    type?: string;
    front?: string | null;
    back?: string | null;
    cloze_text?: string | null;
    extra?: string | null;
    occlusion_data?: unknown;
    tags?: string[] | null;
    sort_order?: number | null;
    generation_jobs?: unknown;
  };
  const job = first(row.generation_jobs);
  const source = first((job as { sources?: unknown } | null)?.sources) as {
    id?: string;
    project_id?: string;
    projects?: unknown;
  } | null;
  const project = first(source?.projects) as { id?: string; user_id?: string } | null;
  if (
    !row.id ||
    !source?.id ||
    !source.project_id ||
    !project?.id ||
    !["basic", "cloze", "image-occlusion"].includes(row.type ?? "")
  ) {
    return [];
  }
  return [{
    id: row.id,
    project_id: source.project_id,
    source_id: source.id,
    source_chunk_id: row.source_chunk_id ?? null,
    type: row.type as CramCardRow["type"],
    front: row.front ?? null,
    back: row.back ?? null,
    cloze_text: row.cloze_text ?? null,
    extra: row.extra ?? null,
    occlusion_data: row.occlusion_data ?? null,
    tags: row.tags ?? [],
    sort_order: row.sort_order ?? 0,
  }];
}

export function cardOrdinals(card: CramCardRow): number[] {
  if (card.type === "cloze") {
    if (!card.cloze_text) return [];
    return extractClozeOrdinals(card.cloze_text);
  }
  if (card.type === "image-occlusion") {
    const data = parseImageOcclusionData(card.occlusion_data);
    const ordinals = data ? occlusionOrdinals(data) : [];
    return ordinals.length > 0 ? ordinals : [0];
  }
  return [0];
}

export async function buildCramSnapshot(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  rawSpec: Partial<CramSelectionSpec>,
  snapshotAt = new Date(),
): Promise<CramSnapshot> {
  const cards = await resolveOwnedCramCards(supabase, userId, rawSpec);
  if (cards.length === 0) {
    return { cards: [], items: [], profiles: [] };
  }

  const cardIds = cards.map((card) => card.id);
  const reviewRows = await loadInitialReviews(supabase, userId, cardIds);
  const reviewByKey = new Map(
    reviewRows.map((review) => [`${review.card_id}:${review.cloze_ord}`, review]),
  );

  const freshFields = cardToRowFields(emptyCard(snapshotAt));
  const items: CramPlanItemInsert[] = cards.flatMap((card) =>
    cardOrdinals(card).map((ordinal) => {
      const review = reviewByKey.get(`${card.id}:${ordinal}`);
      const fields = review
        ? {
            due: review.due,
            stability: review.stability,
            difficulty: review.difficulty,
            elapsed_days: review.elapsed_days,
            scheduled_days: review.scheduled_days,
            reps: review.reps,
            lapses: review.lapses,
            state: review.state,
            last_review: review.last_review,
            learning_steps: review.learning_steps,
          }
        : freshFields;
      return {
        plan_id: planId,
        card_id: card.id,
        project_id: card.project_id,
        cloze_ord: ordinal,
        ...fields,
        version: 0,
      };
    }),
  );

  const projectIds = [...new Set(cards.map((card) => card.project_id))];
  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("id, settings")
    .eq("user_id", userId)
    .in("id", projectIds);
  if (projectError) throw new Error(projectError.message);

  const projects = (projectRows ?? []) as Array<{ id: string; settings: unknown }>;
  const [settingsByProject, userParams] = await Promise.all([
    resolveDeckSettingsForProjects(supabase, userId, projects),
    loadUserParams(supabase, userId),
  ]);
  const profiles = projects.map((project) => ({
    plan_id: planId,
    project_id: project.id,
    fsrs_params: [
      ...(resolveDeckParams(settingsByProject.get(project.id)?.fsrsParams, userParams) ??
        default_w),
    ],
  }));

  return { cards, items, profiles };
}

type InitialReviewRow = {
  card_id: string;
  cloze_ord: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  learning_steps: number;
};

async function loadInitialReviews(
  supabase: SupabaseClient,
  userId: string,
  cardIds: string[],
): Promise<InitialReviewRow[]> {
  const batches: string[][] = [];
  for (let index = 0; index < cardIds.length; index += 500) {
    batches.push(cardIds.slice(index, index + 500));
  }
  const results = await Promise.all(
    batches.map((ids) =>
      supabase
        .from("card_reviews")
        .select(
          "card_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps",
        )
        .eq("user_id", userId)
        .in("card_id", ids),
    ),
  );
  const rows: InitialReviewRow[] = [];
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as InitialReviewRow[]));
  }
  return rows;
}
