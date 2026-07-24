"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { DeckActionsMenu } from "@/components/deck-actions-menu";
import { PageHeaderSlot } from "@/components/page-header-context";

type Props = {
  title: string;
  deckId: string;
  cardCount: number;
  due: number;
  newCount: number;
  showStudy: boolean;
  isPublished?: boolean;
  isCommunity?: boolean;
};

const DECKS_BACK = { href: "/decks", label: "Decks" } as const;

export function DeckPageHeader({
  title: initialTitle,
  deckId,
  cardCount,
  due,
  newCount,
  showStudy,
  isPublished = false,
  isCommunity = false,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle, deckId]);

  return (
    <>
      <PageHeaderSlot title={title} back={DECKS_BACK} />

      <div>
        <DashboardSectionHeader
          title={title}
          rightAction={
            <div className="dh-toolbar-actions">
              <Link href={`/cards?deck=${deckId}`} className="btn btn-ghost btn-sm">
                <i className="ri-table-line" aria-hidden />
                Browse cards
              </Link>
              <Link href={`/create?deck=${deckId}`} className="btn btn-ghost btn-sm">
                <i className="ri-add-line" aria-hidden />
                Create cards
              </Link>
              {showStudy ? (
                <Link href={`/decks/${deckId}/study`} className="btn btn-primary btn-sm">
                  <i className="ri-book-open-line" aria-hidden />
                  Study
                </Link>
              ) : null}
              <DeckActionsMenu
                deck={{
                  id: deckId,
                  title,
                  cardCount,
                  isPublished,
                  isCommunity,
                }}
                omit={["open", "browse", "create", "study"]}
                size="md"
                onRenamed={(name) => {
                  setTitle(name);
                  router.refresh();
                }}
                onDuplicated={(copy) => {
                  router.push(`/decks/${copy.id}`);
                }}
                onDeleted={() => {
                  router.push("/decks");
                }}
                onPublish={() => {
                  // CommunityPublish panel lives on this page below the header.
                  const el = document.getElementById("community-publish");
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            </div>
          }
        />

        <div style={s.statsRow}>
          <span className="chip chip-neutral">
            <i className="ri-stack-line" style={{ marginRight: 4 }} aria-hidden />
            {cardCount.toLocaleString()} {cardCount === 1 ? "card" : "cards"}
          </span>
          <span className="chip chip-due">
            <span className="chip-dot" />
            {due.toLocaleString()} due
          </span>
          <span className="chip chip-new">
            <span className="chip-dot" />
            {newCount.toLocaleString()} new
          </span>
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  statsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: -6,
    marginBottom: 4,
  },
};
