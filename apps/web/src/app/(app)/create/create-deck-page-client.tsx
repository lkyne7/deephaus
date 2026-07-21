"use client";

import dynamic from "next/dynamic";
import type { DeckImportMode } from "@/components/deck-import-view";

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
  return (
    <CreateDeckView
      initialDeckId={initialDeckId}
      initialSourceId={initialSourceId}
      initialImportMode={initialImportMode}
    />
  );
}
