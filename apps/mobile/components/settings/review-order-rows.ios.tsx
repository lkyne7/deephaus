import { Picker, Text, Toggle } from "@expo/ui/swift-ui";
import { disabled, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import {
  NEW_CARD_POSITIONS,
  NEW_CARD_POSITION_LABELS,
  REVIEW_SORT_ORDERS,
  REVIEW_SORT_ORDER_LABELS,
  type NewCardPosition,
  type ReviewOrderSettings,
  type ReviewSortOrder,
} from "@deephaus/shared";

import { useTheme } from "@/lib/theme-context";

/** Review caps offered on the phone. A deck set to another number on the web keeps it. */
const CAP_PRESETS = [50, 100, 150, 200, 300, 500, 1000];
const NO_LIMIT = "none";

function capTag(cap: number | null) {
  return cap == null ? NO_LIMIT : String(cap);
}

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
  const caps =
    value.maxReviewsPerDay != null && !CAP_PRESETS.includes(value.maxReviewsPerDay)
      ? [...CAP_PRESETS, value.maxReviewsPerDay].sort((a, b) => a - b)
      : CAP_PRESETS;

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
      <Picker
        label="Max reviews a day"
        selection={capTag(value.maxReviewsPerDay)}
        onSelectionChange={(picked: string) =>
          set({ maxReviewsPerDay: picked === NO_LIMIT ? null : Number(picked) })
        }
        modifiers={menu}
      >
        <Text modifiers={[tag(NO_LIMIT)]}>No limit</Text>
        {caps.map((cap) => (
          <Text key={cap} modifiers={[tag(String(cap))]}>
            {String(cap)}
          </Text>
        ))}
      </Picker>
    </>
  );
}

export { REVIEW_ORDER_FOOTNOTE } from "./review-order-footnote";
