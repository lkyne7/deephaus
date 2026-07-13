import { CreateDeckPageClient } from "./create-deck-page-client";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string; import?: string }>;
}) {
  const { deck, import: importParam } = await searchParams;
  return (
    <CreateDeckPageClient
      initialDeckId={deck ?? null}
      initialAnkiImportOpen={importParam === "anki"}
    />
  );
}
