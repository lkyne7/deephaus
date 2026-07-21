import { DeckImportView, type DeckImportMode } from "@/components/deck-import-view";

export default async function ImportDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  const initialMode: DeckImportMode = source === "quizlet" ? "quizlet" : "anki";
  return <DeckImportView initialMode={initialMode} />;
}
