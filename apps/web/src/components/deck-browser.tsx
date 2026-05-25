"use client";

import { useMemo, useState } from "react";
import { DeckTable, type DeckRow } from "@/components/deck-table";

export function DeckBrowser({ decks }: { decks: DeckRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return decks;
    return decks.filter((d) => d.title.toLowerCase().includes(needle));
  }, [decks, q]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          background: "var(--white)",
        }}
      >
        <i className="ri-search-line" style={{ color: "var(--ink-400)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search decks"
          style={{
            flex: 1,
            border: 0,
            outline: 0,
            background: "transparent",
            font: "400 14px/20px var(--font-sans)",
            color: "var(--ink-700)",
          }}
        />
      </div>
      <DeckTable decks={filtered} />
    </>
  );
}
