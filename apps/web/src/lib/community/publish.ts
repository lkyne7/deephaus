import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageOcclusionData } from "@deephaus/shared";
import type { DeckPublication } from "./types";

type ProjectCard = {
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: ImageOcclusionData | null;
  tags: string[];
  sort_order: number;
};

async function loadProjectCards(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectCard[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("type, front, back, cloze_text, extra, occlusion_data, tags, sort_order, generation_jobs!inner(source_id, sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", projectId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    type: c.type as "basic" | "cloze" | "image-occlusion",
    front: c.front,
    back: c.back,
    cloze_text: c.cloze_text,
    extra: c.extra,
    occlusion_data: c.occlusion_data as ImageOcclusionData | null,
    tags: c.tags ?? [],
    sort_order: c.sort_order,
  }));
}

async function replacePublicationCards(
  supabase: SupabaseClient,
  publicationId: string,
  cards: ProjectCard[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("publication_cards")
    .delete()
    .eq("publication_id", publicationId);

  if (deleteError) throw new Error(deleteError.message);

  if (cards.length === 0) return;

  const { error: insertError } = await supabase.from("publication_cards").insert(
    cards.map((c) => ({
      publication_id: publicationId,
      type: c.type,
      front: c.front,
      back: c.back,
      cloze_text: c.cloze_text,
      extra: c.extra,
      occlusion_data: c.type === "image-occlusion" ? c.occlusion_data : null,
      tags: c.tags,
      sort_order: c.sort_order,
    })),
  );

  if (insertError) throw new Error(insertError.message);
}

export async function publishProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  opts: { title?: string; description?: string | null } = {},
): Promise<DeckPublication> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, deck_name, name, user_id")
    .eq("id", projectId)
    .single();

  if (projectError || !project) throw new Error("Deck not found");
  if (project.user_id !== userId) throw new Error("Not authorized");

  const cards = await loadProjectCards(supabase, projectId);
  if (cards.length === 0) throw new Error("Publish a deck with at least one card");

  const title = opts.title?.trim() || project.deck_name || project.name;
  const description = opts.description?.trim() || null;

  const { data: existing } = await supabase
    .from("deck_publications")
    .select("*")
    .eq("source_project_id", projectId)
    .maybeSingle();

  if (existing) {
    const nextVersion = existing.version + 1;
    const { data: updated, error: updateError } = await supabase
      .from("deck_publications")
      .update({
        title,
        description,
        version: nextVersion,
        card_count: cards.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError || !updated) throw new Error(updateError?.message ?? "Update failed");
    await replacePublicationCards(supabase, existing.id, cards);
    return updated as DeckPublication;
  }

  const { data: created, error: createError } = await supabase
    .from("deck_publications")
    .insert({
      publisher_id: userId,
      source_project_id: projectId,
      title,
      description,
      card_count: cards.length,
    })
    .select("*")
    .single();

  if (createError || !created) throw new Error(createError?.message ?? "Publish failed");
  await replacePublicationCards(supabase, created.id, cards);
  return created as DeckPublication;
}

export async function unpublishProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<void> {
  const { data: publication } = await supabase
    .from("deck_publications")
    .select("id, publisher_id")
    .eq("source_project_id", projectId)
    .maybeSingle();

  if (!publication) return;
  if (publication.publisher_id !== userId) throw new Error("Not authorized");

  const { error } = await supabase.from("deck_publications").delete().eq("id", publication.id);
  if (error) throw new Error(error.message);
}
