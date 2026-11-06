import { CreateDeckPageClient } from "./create-deck-page-client";
import type { DeckImportMode } from "@/components/deck-import-view";
import { getAuthUser } from "@/lib/data/server-auth";
import { getDisplayNameFromUser, getFirstName } from "@/lib/user/display-name";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string; source?: string; import?: string }>;
}) {
  const { deck, source, import: importParam } = await searchParams;
  const initialImportMode: DeckImportMode | null =
    importParam === "anki" || importParam === "quizlet" ? importParam : null;
  const user = await getAuthUser();
  const hasName = Boolean(user?.user_metadata?.full_name ?? user?.user_metadata?.name);
  return (
    <CreateDeckPageClient
      initialDeckId={deck ?? null}
      initialSourceId={source ?? null}
      initialImportMode={initialImportMode}
      greetingName={user && hasName ? getFirstName(getDisplayNameFromUser(user)) : null}
    />
  );
}
