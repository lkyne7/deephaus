"use client";

import dynamic from "next/dynamic";

const CreateDeckView = dynamic(
  () => import("@/components/create-deck-view").then((m) => m.CreateDeckView),
  { ssr: false },
);

type Props = {
  initialDeckId: string | null;
  initialAnkiImportOpen?: boolean;
};

export function CreateDeckPageClient({ initialDeckId, initialAnkiImportOpen }: Props) {
  return (
    <CreateDeckView
      initialDeckId={initialDeckId}
      initialAnkiImportOpen={initialAnkiImportOpen}
    />
  );
}
