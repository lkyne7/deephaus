"use client";

import dynamic from "next/dynamic";
import type { DeckImportMode } from "@/components/deck-import-view";
import { OfflineNotice } from "@/components/offline-gate";
import type { CreateComposerParams } from "@/lib/decks/create-link";
import { useOnline } from "@/lib/offline/use-online";

const CreateDeckView = dynamic(
  () => import("@/components/create-deck-view").then((m) => m.CreateDeckView),
  { ssr: false },
);

type Props = {
  initialDeckId: string | null;
  initialSourceId?: string | null;
  initialImportMode?: DeckImportMode | null;
  initialPrompt?: string | null;
  initialComposer?: CreateComposerParams;
  greetingName?: string | null;
};

export function CreateDeckPageClient({
  initialDeckId,
  initialSourceId,
  initialImportMode,
  initialPrompt,
  initialComposer,
  greetingName,
}: Props) {
  const online = useOnline();
  return (
    <>
      {!online && (
        <div style={{ padding: "12px 16px 0" }}>
          <OfflineNotice feature="AI card generation" />
        </div>
      )}
      <CreateDeckView
        initialDeckId={initialDeckId}
        initialSourceId={initialSourceId}
        initialImportMode={initialImportMode}
        initialPrompt={initialPrompt}
        initialComposer={initialComposer}
        greetingName={greetingName}
      />
    </>
  );
}
