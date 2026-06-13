"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { TopbarMenuItem } from "@/components/topbar-more-menu";

type Props = {
  title: string;
  deckId: string;
  due: number;
  newRemaining: number;
  showStudy: boolean;
};

const DECKS_BACK = { href: "/study", label: "Decks" } as const;

/** Event used by the topbar menu to trigger the export living in DeckDetail. */
export const DECK_EXPORT_EVENT = "deephaus:export-deck";

export function DeckPageHeader({ title, deckId, due, newRemaining, showStudy }: Props) {
  const action =
    showStudy ? (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {(due > 0 || newRemaining > 0) && (
          <span style={{ font: "500 13px/20px var(--font-sans)", color: "var(--fg-3)" }}>
            <strong style={{ color: "var(--ink-900)" }}>{due}</strong> due
            {" · "}
            <strong style={{ color: "var(--ink-900)" }}>{newRemaining}</strong> new
          </span>
        )}
        <Link href={`/decks/${deckId}/study`} className="btn btn-primary">
          <i className="ri-book-open-line" />
          Study Now
        </Link>
      </div>
    ) : undefined;

  const menuItems = useMemo<TopbarMenuItem[]>(() => {
    const items: TopbarMenuItem[] = [];
    if (showStudy) {
      items.push({
        id: "study-now",
        label: "Study now",
        icon: "ri-book-open-line",
        href: `/decks/${deckId}/study`,
      });
    }
    items.push(
      {
        id: "browse-cards",
        label: "Browse cards",
        icon: "ri-table-view",
        href: `/decks?deck=${deckId}`,
      },
      {
        id: "create-cards",
        label: "Create cards",
        icon: "ri-add-line",
        href: `/decks/new?deck=${deckId}`,
      },
      {
        id: "export-apkg",
        label: "Export .apkg",
        icon: "ri-download-2-line",
        onClick: () => window.dispatchEvent(new CustomEvent(DECK_EXPORT_EVENT)),
      },
    );
    return items;
  }, [deckId, showStudy]);

  return (
    <PageHeaderSlot
      title={title}
      back={DECKS_BACK}
      action={action}
      menuItems={menuItems}
    />
  );
}
