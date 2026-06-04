"use client";

import type { ReactNode } from "react";
import { PageHeaderSlot } from "@/components/page-header-context";

type Props = {
  deckId: string;
  deckTitle: string;
  sessionActions?: ReactNode;
};

export function StudyPageHeader({ deckId, deckTitle, sessionActions }: Props) {
  return (
    <PageHeaderSlot
      breadcrumbs={[
        { label: "Decks", href: "/study" },
        { label: deckTitle, href: `/decks/${deckId}` },
        { label: "Study" },
      ]}
      action={sessionActions}
    />
  );
}
