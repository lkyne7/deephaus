"use client";

import { useMemo, type ReactNode } from "react";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { TopbarMenuItem } from "@/components/topbar-more-menu";

type Props = {
  deckId: string;
  deckTitle: string;
  sessionActions?: ReactNode;
  menuItems?: TopbarMenuItem[];
};

export function StudyPageHeader({ deckId, deckTitle, sessionActions, menuItems }: Props) {
  const items = useMemo<TopbarMenuItem[]>(
    () => [
      ...(menuItems ?? []),
      {
        id: "end-session",
        label: "End session",
        icon: "ri-stop-circle-line",
        href: `/decks/${deckId}`,
      },
    ],
    [menuItems, deckId],
  );

  return (
    <PageHeaderSlot
      breadcrumbs={[
        { label: "Decks", href: "/study" },
        { label: deckTitle, href: `/decks/${deckId}` },
        { label: "Study" },
      ]}
      action={sessionActions}
      menuItems={items}
    />
  );
}
