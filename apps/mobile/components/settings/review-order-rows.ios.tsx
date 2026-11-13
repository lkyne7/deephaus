import { Picker, Text, Toggle } from "@expo/ui/swift-ui";
import { disabled, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import {
  MAX_REVIEWS_PER_DAY_LIMIT,
  NEW_CARD_POSITIONS,
  NEW_CARD_POSITION_LABELS,
  REVIEW_SORT_ORDERS,
  REVIEW_SORT_ORDER_LABELS,
  type NewCardPosition,
  type ReviewOrderSettings,
  type ReviewSortOrder,
} from "@deephaus/shared";

import { useTheme } from "@/lib/theme-context";
import { NumberFieldRow } from "./study-limit-rows";

/**
 * Anki-style review order and limits as native Form rows, for Study defaults
 * and a deck's own settings. Place inside a SwiftUI Section.
 */
export function ReviewOrderRows({
  value,
  onChange,
  locked = false,
}: {
  value: ReviewOrderSettings;
  onChange: (next: ReviewOrderSettings) => void;
  /** Shows the values but doesn't allow changes (a deck following the defaults). */
  locked?: boolean;
}) {
  const { colors } = useTheme();
  const set = (patch: Partial<ReviewOrderSettings>) => onChange({ ...value, ...patch });
  const menu = [pickerStyle("menu"), tint(colors.fgTertiary), disabled(locked)];

  return (
    <>
      <Toggle
        label="Space out sibling cards"
        isOn={value.spaceOutSiblings}
        onIsOnChange={(spaceOutSiblings) => set({ spaceOutSiblings })}
        modifiers={[tint(colors.accent), disabled(locked)]}
      />
      <Picker
        label="New cards"
        selection={value.newCardPosition}
        onSelectionChange={(position: string) =>
          set({ newCardPosition: position as NewCardPosition })
        }
        modifiers={menu}
      >
        {NEW_CARD_POSITIONS.map((position) => (
          <Text key={position} modifiers={[tag(position)]}>
            {NEW_CARD_POSITION_LABELS[position]}
          </Text>
        ))}
      </Picker>
      <Picker
        label="Review order"
        selection={value.reviewSortOrder}
        onSelectionChange={(order: string) => set({ reviewSortOrder: order as ReviewSortOrder })}
        modifiers={menu}
      >
        {REVIEW_SORT_ORDERS.map((order) => (
          <Text key={order} modifiers={[tag(order)]}>
            {REVIEW_SORT_ORDER_LABELS[order]}
          </Text>
        ))}
      </Picker>
      <NumberFieldRow
        label="Max reviews a day"
        value={value.maxReviewsPerDay}
        max={MAX_REVIEWS_PER_DAY_LIMIT}
        placeholder="No limit"
        allowEmpty
        locked={locked}
        onChange={(maxReviewsPerDay) => set({ maxReviewsPerDay })}
      />
    </>
  );
}

export { REVIEW_ORDER_FOOTNOTE } from "./review-order-footnote";
