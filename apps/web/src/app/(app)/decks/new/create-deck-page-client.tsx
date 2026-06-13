"use client";

import dynamic from "next/dynamic";

const CreateDeckView = dynamic(
  () => import("@/components/create-deck-view").then((m) => m.CreateDeckView),
  { ssr: false },
);

type Props = {
  initialDeckId: string | null;
};

export function CreateDeckPageClient({ initialDeckId }: Props) {
  return <CreateDeckView initialDeckId={initialDeckId} />;
}
