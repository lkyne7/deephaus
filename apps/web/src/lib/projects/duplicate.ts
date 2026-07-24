import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export class DuplicateProjectError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DuplicateProjectError";
    this.status = status;
  }
}

export type DuplicateProjectResult = {
  id: string;
  name: string;
  deck_name: string;
  settings: unknown;
  card_count: number;
};

type CardCopy = {
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: unknown;
  tags: string[];
  sort_order: number;
  source_ref: string | null;
  source_quote: string | null;
};

/**
 * Duplicate a deck: copy cards + settings into a new project with fresh study
 * progress. Sources are not copied — cards land under a carrier text source.
 */
export async function duplicateProject(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<DuplicateProjectResult> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, deck_name, settings")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (projectError) {
    throw new DuplicateProjectError(projectError.message, 500);
  }
  if (!project) {
    throw new DuplicateProjectError("Deck not found", 404);
  }

  const baseName = (
    (project.deck_name as string | null)?.trim() ||
    (project.name as string | null)?.trim() ||
    "Untitled deck"
  ).slice(0, 110);
  const copyName = `${baseName} copy`;

  const cards = await loadProjectCards(supabase, projectId);

  const { data: created, error: createError } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: copyName,
      deck_name: copyName,
      settings: project.settings ?? { cardMix: "basic", detailLevel: "medium" },
    })
    .select("id, name, deck_name, settings")
    .single();

  if (createError || !created) {
    throw new DuplicateProjectError(
      createError?.message ?? "Could not duplicate deck.",
      500,
    );
  }

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .insert({
      project_id: created.id,
      type: "text",
      raw_text: "Duplicated deck",
      title: null,
    })
    .select("id")
    .single();

  if (sourceError || !source) {
    await supabase.from("projects").delete().eq("id", created.id);
    throw new DuplicateProjectError(
      sourceError?.message ?? "Could not create duplicate source.",
      500,
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      source_id: source.id,
      status: "ready",
      progress: 100,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    await supabase.from("projects").delete().eq("id", created.id);
    throw new DuplicateProjectError(
      jobError?.message ?? "Could not create duplicate job.",
      500,
    );
  }

  if (cards.length > 0) {
    const rows = cards.map((card) => ({
      job_id: job.id as string,
      type: card.type === "image-occlusion" ? "image-occlusion" : card.type,
      front: card.front,
      back: card.back,
      cloze_text: card.cloze_text,
      extra: card.extra,
      occlusion_data: card.occlusion_data,
      tags: card.tags ?? [],
      sort_order: card.sort_order,
      source_ref: card.source_ref,
      source_quote: card.source_quote,
      user_edited: true,
    }));

    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error: cardsError } = await supabase.from("cards").insert(batch);
      if (cardsError) {
        await supabase.from("projects").delete().eq("id", created.id);
        throw new DuplicateProjectError(cardsError.message, 500);
      }
    }
  }

  return {
    id: created.id as string,
    name: created.name as string,
    deck_name: created.deck_name as string,
    settings: created.settings,
    card_count: cards.length,
  };
}

async function loadProjectCards(
  supabase: SupabaseClient,
  projectId: string,
): Promise<CardCopy[]> {
  const { data: jobs, error: jobsError } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(project_id)")
    .eq("sources.project_id", projectId);

  if (jobsError) {
    throw new DuplicateProjectError(jobsError.message, 500);
  }

  const jobIds = (jobs ?? []).map((job) => job.id as string);
  if (jobIds.length === 0) return [];

  const cards: CardCopy[] = [];
  for (let i = 0; i < jobIds.length; i += 50) {
    const batch = jobIds.slice(i, i + 50);
    const { data, error } = await supabase
      .from("cards")
      .select(
        "type, front, back, cloze_text, extra, occlusion_data, tags, sort_order, source_ref, source_quote",
      )
      .in("job_id", batch)
      .order("sort_order", { ascending: true });
    if (error) throw new DuplicateProjectError(error.message, 500);
    for (const row of data ?? []) {
      const type = row.type as CardCopy["type"];
      if (type !== "basic" && type !== "cloze" && type !== "image-occlusion") continue;
      cards.push({
        type,
        front: (row.front as string | null) ?? null,
        back: (row.back as string | null) ?? null,
        cloze_text: (row.cloze_text as string | null) ?? null,
        extra: (row.extra as string | null) ?? null,
        occlusion_data: row.occlusion_data ?? null,
        tags: (row.tags as string[] | null) ?? [],
        sort_order: (row.sort_order as number | null) ?? cards.length,
        source_ref: (row.source_ref as string | null) ?? null,
        source_quote: (row.source_quote as string | null) ?? null,
      });
    }
  }

  return cards.sort((a, b) => a.sort_order - b.sort_order);
}
