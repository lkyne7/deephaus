"use client";

import dynamic from "next/dynamic";
import type { DeckImportMode } from "@/components/deck-import-view";
import { OfflineNotice } from "@/components/offline-gate";
import { useOnline } from "@/lib/offline/use-online";

const CreateDeckView = dynamic(
  () => import("@/components/create-deck-view").then((m) => m.CreateDeckView),
  { ssr: false },
);

type Props = {
  initialDeckId: string | null;
  initialSourceId?: string | null;
  initialImportMode?: DeckImportMode | null;
};

export function CreateDeckPageClient({
  initialDeckId,
  initialSourceId,
  initialImportMode,
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
      />
    </>
  );
}
