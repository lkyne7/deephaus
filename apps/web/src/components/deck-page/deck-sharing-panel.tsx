"use client";

import { PublishForm } from "@/components/community/publish-form";
import { DeckPaneHead } from "@/components/deck-page/deck-pane-head";
import type { DeckPublication } from "@/lib/community/types";
import "./deck-panels.css";

type Props = {
  projectId: string;
  deckName: string;
  cardCount: number;
  publication: DeckPublication | null;
  onPublicationChange: (next: DeckPublication | null) => void;
  onClose: () => void;
};

/** The deck pane's Sharing view: the same publish form Community uses. */
export function DeckSharingPanel({
  projectId,
  deckName,
  cardCount,
  publication,
  onPublicationChange,
  onClose,
}: Props) {
  return (
    <aside className="dh-panel dh-panel--float dh-bench-panel dhd-panel" aria-label="Sharing">
      <DeckPaneHead title="Sharing" deckName={deckName} onBack={onClose} />
      <PublishForm
        projectId={projectId}
        deckName={deckName}
        cardCount={cardCount}
        publication={publication}
        onPublicationChange={onPublicationChange}
      />
    </aside>
  );
}
