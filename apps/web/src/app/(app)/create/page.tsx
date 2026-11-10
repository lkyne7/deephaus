import { CreateDeckPageClient } from "./create-deck-page-client";
import type { DeckImportMode } from "@/components/deck-import-view";
import { parseCreateParams } from "@/lib/decks/create-link";
import { getAuthUser } from "@/lib/data/server-auth";
import { getDisplayNameFromUser, getFirstName } from "@/lib/user/display-name";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{
    deck?: string;
    source?: string;
    card?: string;
    import?: string;
    prompt?: string;
    detail?: string;
    focus?: string;
    intent?: string;
  }>;
}) {
  const { deck, source, card, import: importParam, prompt, detail, focus, intent } = await searchParams;
  const initialImportMode: DeckImportMode | null =
    importParam === "anki" || importParam === "quizlet" ? importParam : null;
  const user = await getAuthUser();
  const hasName = Boolean(user?.user_metadata?.full_name ?? user?.user_metadata?.name);
  return (
    <CreateDeckPageClient
      initialDeckId={deck ?? null}
      initialSourceId={source ?? null}
      initialCardId={card ?? null}
      initialImportMode={initialImportMode}
      initialPrompt={prompt ?? null}
      initialComposer={parseCreateParams({ detail, focus, intent })}
      greetingName={user && hasName ? getFirstName(getDisplayNameFromUser(user)) : null}
    />
  );
}
