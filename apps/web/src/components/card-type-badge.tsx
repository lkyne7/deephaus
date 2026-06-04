import { CARD_EDITOR_TYPE_OPTIONS, cardTypeLabel, type CardType } from "@deephaus/shared";

/** Small read-only badge showing a card's fixed type (Front/Back, Cloze, Occlusion). */
export function CardTypeBadge({ type }: { type: CardType }) {
  const icon = CARD_EDITOR_TYPE_OPTIONS.find((o) => o.value === type)?.icon;
  return (
    <span className="chip chip-neutral" style={{ alignSelf: "flex-start" }}>
      {icon ? <i className={icon} aria-hidden /> : null}
      {cardTypeLabel(type, "short")}
    </span>
  );
}
