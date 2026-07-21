import { CreateDeckPageClient } from "./create-deck-page-client";
import type { DeckImportMode } from "@/components/deck-import-view";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string; source?: string; import?: string }>;
}) {
  const { deck, source, import: importParam } = await searchParams;
  const initialImportMode: DeckImportMode | null =
    importParam === "anki" || importParam === "quizlet" ? importParam : null;
  return (
    <CreateDeckPageClient
      initialDeckId={deck ?? null}
      initialSourceId={source ?? null}
      initialImportMode={initialImportMode}
    />
  );
}
