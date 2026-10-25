import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicationCardContent } from "./types";

type CardInsert = PublicationCardContent & { job_id: string };

function cardInsert(jobId: string, card: PublicationCardContent): CardInsert {
  return {
    job_id: jobId,
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    occlusion_data: card.occlusion_data ?? null,
    tags: card.tags ?? [],
    sort_order: card.sort_order,
  };
}

export async function createProjectFromCards(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  cards: PublicationCardContent[],
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
    const rows: CardInsert[] = cards.map((c) => cardInsert(job.id, c));

    const { error: cardsError } = await supabase.from("cards").insert(rows);
    if (cardsError) throw new Error(cardsError.message);
  }

  return { projectId: project.id, jobId: job.id };
}

export async function replaceProjectCards(
  supabase: SupabaseClient,
  projectId: string,
  cards: PublicationCardContent[],
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
    .select("id")
    .eq("job_id", jobId);

  if (existingCards && existingCards.length > 0) {
    const { error: deleteError } = await supabase
      .from("cards")
      .delete()
      .in(
        "id",
        existingCards.map((c) => c.id),
      );
    if (deleteError) throw new Error(deleteError.message);
  }

  if (cards.length > 0) {
    const rows: CardInsert[] = cards.map((c) => cardInsert(jobId!, c));

    const { error: insertError } = await supabase.from("cards").insert(rows);
    if (insertError) throw new Error(insertError.message);
  }

  return jobId;
}
