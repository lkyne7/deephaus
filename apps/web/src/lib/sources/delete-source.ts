import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidateCachedSourceDocument } from "@/lib/sources/source-document-cache";

const SOURCE_FILE_BUCKET = "pdfs";

export type DeleteSourceResult = {
  sourceId: string;
  projectId: string;
  unlinkedCards: number;
};

/**
 * Delete a source without deleting its flashcards.
 *
 * Cards are tied to the deck through `generation_jobs → sources`. A hard delete
 * would cascade through jobs and wipe cards, so we:
 * 1. Clear per-card provenance (chunk / ref / quote)
 * 2. Reassign jobs to another source in the same project (or a hidden topic carrier)
 * 3. Delete the source row (chunks + extraction jobs cascade)
 * 4. Best-effort remove stored originals / previews
 */
export async function deleteSourcePreservingCards(
  supabase: SupabaseClient,
  sourceId: string,
  userId: string,
): Promise<DeleteSourceResult> {
  const { data: owned } = await supabase
    .from("sources")
    .select(
      "id, project_id, storage_path, preview_storage_path, projects!inner(user_id)",
    )
    .eq("id", sourceId)
    .eq("projects.user_id", userId)
    .single();

  if (!owned) {
    throw new DeleteSourceError("Source not found", 404);
  }

  const projectId = owned.project_id as string;
  const storagePaths = [owned.storage_path, owned.preview_storage_path]
    .filter((path): path is string => Boolean(path) && !/^https?:\/\//i.test(path));

  const unlinkedCards = await clearCardProvenanceForSource(supabase, sourceId);
  const keepSourceId = await resolveJobCarrierSource(supabase, projectId, sourceId);

  const { error: reassignError } = await supabase
    .from("generation_jobs")
    .update({ source_id: keepSourceId })
    .eq("source_id", sourceId);
  if (reassignError) {
    throw new DeleteSourceError(reassignError.message, 500);
  }

  const { error: deleteError } = await supabase.from("sources").delete().eq("id", sourceId);
  if (deleteError) {
    throw new DeleteSourceError(deleteError.message, 500);
  }

  invalidateCachedSourceDocument(sourceId);

  if (storagePaths.length > 0) {
    await supabase.storage.from(SOURCE_FILE_BUCKET).remove(storagePaths).catch(() => undefined);
  }

  return { sourceId, projectId, unlinkedCards };
}

export class DeleteSourceError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DeleteSourceError";
    this.status = status;
  }
}

async function clearCardProvenanceForSource(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<number> {
  const [{ data: chunks }, { data: jobs }] = await Promise.all([
    supabase.from("source_chunks").select("id").eq("source_id", sourceId),
    supabase.from("generation_jobs").select("id").eq("source_id", sourceId),
  ]);

  const chunkIds = (chunks ?? []).map((row) => row.id as string);
  const jobIds = (jobs ?? []).map((row) => row.id as string);
  const cleared = new Set<string>();

  const clearRows = async (filter: {
    column: "source_chunk_id" | "job_id";
    ids: string[];
  }) => {
    if (filter.ids.length === 0) return;
    // Batch to stay under PostgREST URL limits on large decks.
    for (let i = 0; i < filter.ids.length; i += 200) {
      const batch = filter.ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from("cards")
        .update({
          source_chunk_id: null,
          source_ref: null,
          source_quote: null,
          updated_at: new Date().toISOString(),
        })
        .in(filter.column, batch)
        .select("id");
      if (error) throw new DeleteSourceError(error.message, 500);
      for (const row of data ?? []) cleared.add(row.id as string);
    }
  };

  await clearRows({ column: "source_chunk_id", ids: chunkIds });
  await clearRows({ column: "job_id", ids: jobIds });
  return cleared.size;
}

/**
 * Pick another source in the deck to host generation jobs, or create a hidden
 * topic carrier (topic/apkg sources are excluded from the Create sources rail).
 */
async function resolveJobCarrierSource(
  supabase: SupabaseClient,
  projectId: string,
  excludingSourceId: string,
): Promise<string> {
  const { data: siblings, error } = await supabase
    .from("sources")
    .select("id, type")
    .eq("project_id", projectId)
    .neq("id", excludingSourceId)
    .order("created_at", { ascending: true });

  if (error) throw new DeleteSourceError(error.message, 500);

  const rows = (siblings ?? []) as Array<{ id: string; type: string }>;
  const preferred =
    rows.find((row) => row.type !== "topic" && row.type !== "apkg") ?? rows[0];
  if (preferred) return preferred.id;

  const { data: carrier, error: insertError } = await supabase
    .from("sources")
    .insert({
      project_id: projectId,
      type: "topic",
      raw_text: "Deck cards",
      title: null,
    })
    .select("id")
    .single();

  if (insertError || !carrier) {
    // Older DBs may reject `topic`; fall back to an empty text source.
    const { data: fallback, error: fallbackError } = await supabase
      .from("sources")
      .insert({
        project_id: projectId,
        type: "text",
        raw_text: "",
        title: null,
      })
      .select("id")
      .single();
    if (fallbackError || !fallback) {
      throw new DeleteSourceError(
        insertError?.message ?? fallbackError?.message ?? "Could not preserve flashcards.",
        500,
      );
    }
    return fallback.id as string;
  }

  return carrier.id as string;
}
