import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageOcclusionData } from "@deephaus/shared";
import type { PublicationCard } from "./types";

type CommunityCardPayload = Pick<
  PublicationCard,
  "type" | "front" | "back" | "cloze_text" | "extra" | "occlusion_data" | "tags" | "sort_order"
>;

type CardInsert = {
  job_id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: ImageOcclusionData | null;
  tags: string[];
  sort_order: number;
};

type ExistingProjectCard = CommunityCardPayload & {
  id: string;
};

function cardInsertFromPublication(jobId: string, card: CommunityCardPayload): CardInsert {
  return {
    job_id: jobId,
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    occlusion_data: card.type === "image-occlusion" ? card.occlusion_data : null,
    tags: card.tags ?? [],
    sort_order: card.sort_order,
  };
}

function cardContentKey(card: CommunityCardPayload): string {
  return JSON.stringify({
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    occlusion_data: card.type === "image-occlusion" ? card.occlusion_data : null,
    tags: card.tags ?? [],
  });
}

export async function createProjectFromCards(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  cards: CommunityCardPayload[],
): Promise<{ projectId: string; jobId: string }> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: title,
      deck_name: title,
      settings: { cardMix: "basic", detailLevel: "medium" },
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to create project");
  }

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .insert({
      project_id: project.id,
      type: "text",
      raw_text: "Imported from DeepHaus Community",
    })
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error(sourceError?.message ?? "Failed to create source");
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
    throw new Error(jobError?.message ?? "Failed to create generation job");
  }

  if (cards.length > 0) {
    const rows: CardInsert[] = cards.map((c) => cardInsertFromPublication(job.id, c));

    const { error: cardsError } = await supabase.from("cards").insert(rows);
    if (cardsError) throw new Error(cardsError.message);
  }

  return { projectId: project.id, jobId: job.id };
}

export async function replaceProjectCards(
  supabase: SupabaseClient,
  projectId: string,
  cards: CommunityCardPayload[],
): Promise<string> {
  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(project_id)")
    .eq("sources.project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);

  let jobId = jobs?.[0]?.id as string | undefined;

  if (!jobId) {
    throw new Error("Project has no generation job");
  }

  const { data: existingCards } = await supabase
    .from("cards")
    .select("id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order")
    .eq("job_id", jobId);

  const existingByContent = new Map<string, ExistingProjectCard[]>();
  for (const existing of (existingCards ?? []) as ExistingProjectCard[]) {
    const key = cardContentKey(existing);
    const bucket = existingByContent.get(key) ?? [];
    bucket.push(existing);
    existingByContent.set(key, bucket);
  }

  const preservedIds = new Set<string>();
  const updates: Array<CardInsert & { id: string }> = [];
  const inserts: CardInsert[] = [];

  for (const card of cards) {
    const bucket = existingByContent.get(cardContentKey(card));
    const existing = bucket?.shift();
    const row = cardInsertFromPublication(jobId, card);

    if (existing) {
      preservedIds.add(existing.id);
      updates.push({ id: existing.id, ...row });
    } else {
      inserts.push(row);
    }
  }

  if (updates.length > 0) {
    const { error: updateError } = await supabase.from("cards").upsert(updates, { onConflict: "id" });
    if (updateError) throw new Error(updateError.message);
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from("cards").insert(inserts);
    if (insertError) throw new Error(insertError.message);
  }

  const staleIds = ((existingCards ?? []) as ExistingProjectCard[])
    .filter((card) => !preservedIds.has(card.id))
    .map((card) => card.id);

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase.from("cards").delete().in("id", staleIds);
    if (deleteError) throw new Error(deleteError.message);
  }

  return jobId;
}
