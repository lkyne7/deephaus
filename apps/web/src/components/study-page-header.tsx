"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { StudyDeckOption } from "@/lib/study/decks";

type Props = {
  deckId: string;
  deckTitle: string;
  studyDecks: StudyDeckOption[];
  sessionActions?: ReactNode;
};

export function StudyPageHeader({ deckId, deckTitle, studyDecks, sessionActions }: Props) {
  const router = useRouter();

  const action = (
    <div style={s.actions}>
      {studyDecks.length > 0 ? (
        <select
          aria-label="Switch deck"
          value={deckId}
          onChange={(e) => {
            const nextId = e.target.value;
            if (nextId && nextId !== deckId) {
              router.push(`/decks/${nextId}/study`);
            }
          }}
          style={s.deckSelect}
        >
          {studyDecks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
              {d.waiting > 0 ? ` (${d.due} due · ${d.new} new)` : " (caught up)"}
            </option>
          ))}
        </select>
      ) : (
        <span style={s.deckTitle}>{deckTitle}</span>
      )}
      {sessionActions}
    </div>
  );

  return <PageHeaderSlot title="Study" action={action} />;
}

const s: Record<string, React.CSSProperties> = {
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  deckSelect: {
    maxWidth: 280,
    minWidth: 140,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border-2)",
    background: "var(--white)",
    color: "var(--ink-900)",
    font: "500 13px/18px var(--font-sans)",
    cursor: "pointer",
  },
  deckTitle: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-3)",
    maxWidth: 280,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
