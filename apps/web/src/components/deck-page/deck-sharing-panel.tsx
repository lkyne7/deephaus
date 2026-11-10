"use client";

import { useRouter } from "next/navigation";
import { PublishForm } from "@/components/community/publish-form";
import type { DeckPublication } from "@/lib/community/types";

type Props = {
  projectId: string;
  deckName: string;
  cardCount: number;
  publication: DeckPublication | null;
  onPublicationChange: (next: DeckPublication | null) => void;
  onClose: () => void;
};

/** The deck page's Sharing panel: the same publish form Community uses. */
export function DeckSharingPanel({
  projectId,
  deckName,
  cardCount,
  publication,
  onPublicationChange,
  onClose,
}: Props) {
  const router = useRouter();

  return (
    <aside className="dh-panel dhd-panel" aria-label="Sharing">
      <div className="dh-panel__head">
        <b className="dhd-panel__title">Sharing</b>
        <span className="dh-spacer" />
        <button type="button" className="dhd-icon-btn" aria-label="Close" onClick={onClose}>
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <PublishForm
        projectId={projectId}
        deckName={deckName}
        cardCount={cardCount}
        publication={publication}
        onPublicationChange={(next) => {
          const wasPublished = Boolean(publication);
          onPublicationChange(next);
          // Publishing or unpublishing changes the page's header and rail.
          if (wasPublished !== Boolean(next)) router.refresh();
        }}
      />
    </aside>
  );
}
