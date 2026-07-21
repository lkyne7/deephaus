import type { SourceType } from "@deephaus/shared";
import { readJson } from "@/lib/background-tasks/api";

/** One entry in a deck's sources rail (GET /api/projects/:id/sources). */
export type DeckSource = {
  id: string;
  type: SourceType;
  title: string;
  pageCount: number | null;
  hasStorage: boolean;
  hasPreview: boolean;
  externalUrl: string | null;
  contentEditedAt: string | null;
  createdAt: string;
};

export async function fetchDeckSources(deckId: string): Promise<DeckSource[]> {
  const res = await fetch(`/api/projects/${deckId}/sources`, {
    credentials: "include",
  });
  const data = await readJson<{ sources: DeckSource[] }>(res);
  return data.sources ?? [];
}

/** Whether a source has an original file we can display or download. */
export function sourceHasOriginal(
  source: Pick<DeckSource, "type" | "hasStorage" | "externalUrl">,
): boolean {
  return (
    source.hasStorage &&
    !source.externalUrl &&
    (source.type === "pdf" ||
      source.type === "docx" ||
      source.type === "pptx" ||
      source.type === "video")
  );
}
