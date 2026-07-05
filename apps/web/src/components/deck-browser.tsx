"use client";

import { AnimatePresence, m } from "motion/react";
import { useMemo, useState } from "react";
import { DeckTable, type DeckRow } from "@/components/deck-table";
import { FadeIn } from "@/components/motion/fade-in";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";

export function DeckBrowser({ decks }: { decks: DeckRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return decks;
    return decks.filter((d) => d.title.toLowerCase().includes(needle));
  }, [decks, q]);

  return (
    <>
      <FadeIn>
        <UntitledSearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search decks"
          aria-label="Search decks"
        />
      </FadeIn>
      <AnimatePresence mode="wait">
        <m.div
          key={q.trim().toLowerCase() || "__all__"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <DeckTable decks={filtered} />
        </m.div>
      </AnimatePresence>
    </>
  );
}
