import type { SupabaseClient } from "@supabase/supabase-js";
import { CramServiceError } from "@/lib/cram/service";

export async function loadCramSelectorOptions(
  supabase: SupabaseClient,
  userId: string,
) {
  const [projectsResult, sourcesResult, cardRows] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, deck_name")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("sources")
      .select("id, project_id, type, title, storage_path, created_at, projects!inner(user_id)")
      .eq("projects.user_id", userId)
      .order("created_at", { ascending: false }),
    loadAllOptionCardRows(supabase, userId),
  ]);
  for (const result of [projectsResult, sourcesResult]) {
    if (result.error) throw new CramServiceError(result.error.message);
  }

  const projects = (projectsResult.data ?? []).map((project) => ({
    id: project.id,
    name: project.deck_name || project.name,
  }));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const cards = cardRows.flatMap(normalizeOptionCard);

  const deckCounts = countBy(cards.map((card) => card.project_id));
  const sourceCounts = countBy(cards.map((card) => card.source_id));
  const tagCounts = countBy(cards.flatMap((card) => card.tags));

  const sources = (sourcesResult.data ?? []).map((source) => ({
    id: source.id,
    name: sourceLabel(source.type, source.title, source.storage_path),
    label: sourceLabel(source.type, source.title, source.storage_path),
    deck_id: source.project_id,
    deck_name: projectNames.get(source.project_id) ?? null,
    type: source.type,
    card_count: sourceCounts.get(source.id) ?? 0,
    count: sourceCounts.get(source.id) ?? 0,
  }));

  return {
    options: {
      decks: projects.map((project) => ({
        ...project,
        card_count: deckCounts.get(project.id) ?? 0,
        count: deckCounts.get(project.id) ?? 0,
      })),
      sources,
      tags: [...tagCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, count]) => ({ tag, count })),
    },
  };
}

async function loadAllOptionCardRows(
  supabase: SupabaseClient,
  userId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("cards")
      .select(
        "id, tags, generation_jobs!inner(sources!inner(id, project_id, projects!inner(user_id)))",
      )
      .eq("generation_jobs.sources.projects.user_id", userId)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new CramServiceError(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

type OptionCard = {
  id: string;
  project_id: string;
  source_id: string;
  tags: string[];
};

function normalizeOptionCard(raw: unknown): OptionCard[] {
  const row = raw as {
    id?: string;
    tags?: string[] | null;
    generation_jobs?: unknown;
  };
  const job = first(row.generation_jobs);
  const source = first((job as { sources?: unknown } | null)?.sources) as {
    id?: string;
    project_id?: string;
  } | null;
  if (!row.id || !source?.id || !source.project_id) return [];
  return [{
    id: row.id,
    project_id: source.project_id,
    source_id: source.id,
    tags: row.tags ?? [],
  }];
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sourceLabel(type: string, title: string | null, storagePath: string | null) {
  if (title?.trim()) return title.trim();
  if (storagePath) {
    const name = storagePath.split("/").filter(Boolean).at(-1);
    if (name) return name;
  }
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} source`;
}
