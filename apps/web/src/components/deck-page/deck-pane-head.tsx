/** The head of a view in the deck's side pane: back to the summary, then what this view is. */
export function DeckPaneHead({
  title,
  deckName,
  onBack,
}: {
  title: string;
  deckName: string;
  onBack: () => void;
}) {
  return (
    <div className="dh-panel__head dh-bench-panel__head dhd-pane-head">
      <button
        type="button"
        className="dhd-icon-btn"
        aria-label="Back to deck"
        title="Back to deck"
        onClick={onBack}
      >
        <i className="ri-arrow-left-line" aria-hidden />
      </button>
      <div className="dh-bench-panel__heading">
        <div className="dh-bench-panel__title">{title}</div>
        <div className="dh-bench-panel__sub dhd-pane-head__deck" title={deckName}>
          {deckName}
        </div>
      </div>
    </div>
  );
}
