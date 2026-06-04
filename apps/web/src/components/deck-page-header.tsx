"use client";

import Link from "next/link";
import { PageHeaderSlot } from "@/components/page-header-context";

type Props = {
  title: string;
  deckId: string;
  due: number;
  newRemaining: number;
  showStudy: boolean;
};

const DECKS_BACK = { href: "/study", label: "Decks" } as const;

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

  return (
    <PageHeaderSlot
      title={title}
      back={DECKS_BACK}
      action={action}
    />
  );
}
