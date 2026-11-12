import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import {
  MAX_REVIEWS_PER_DAY_LIMIT,
  type NewCardPosition,
  type ReviewOrderSettings,
  type ReviewSortOrder,
} from "@deephaus/shared";

import { Field } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const POSITION_OPTIONS: readonly { value: NewCardPosition; label: string }[] = [
  { value: "after", label: "After" },
  { value: "mixed", label: "Mixed" },
  { value: "before", label: "Before" },
];

const ORDER_OPTIONS: readonly { value: ReviewSortOrder; label: string }[] = [
  { value: "due", label: "Due date" },
  { value: "retrievability", label: "Weakest" },
  { value: "random", label: "Random" },
];

/**
 * Review order and limits as React Native rows: the deck settings sheet on
 * every platform, and Study defaults on Android (iOS uses ReviewOrderRows).
 * Rows draw a top hairline, so they sit under another row in a grouped list.
 */
export function ReviewOrderControls({
  value,
  onChange,
}: {
  value: ReviewOrderSettings;
  onChange: (next: ReviewOrderSettings) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [capText, setCapText] = useState(value.maxReviewsPerDay == null ? "" : String(value.maxReviewsPerDay));
  useEffect(() => {
    setCapText(value.maxReviewsPerDay == null ? "" : String(value.maxReviewsPerDay));
  }, [value.maxReviewsPerDay]);
  const set = (patch: Partial<ReviewOrderSettings>) => onChange({ ...value, ...patch });

  return (
    <>
      <View style={[styles.row, styles.rowLine]}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Space out sibling cards</Text>
          <Text style={styles.rowHint}>A card&apos;s other gaps wait until tomorrow once you study one.</Text>
        </View>
        <Switch
          value={value.spaceOutSiblings}
          onValueChange={(spaceOutSiblings) => {
            haptics.selection();
            set({ spaceOutSiblings });
          }}
          trackColor={{ true: colors.accent }}
        />
      </View>
      <View style={[styles.stack, styles.rowLine]}>
        <Text style={styles.rowTitle}>New cards, relative to reviews</Text>
        <SegmentedControl
          options={POSITION_OPTIONS}
          value={value.newCardPosition}
          onChange={(newCardPosition) => set({ newCardPosition })}
          accessibilityLabel="New cards, relative to reviews"
        />
      </View>
      <View style={[styles.stack, styles.rowLine]}>
        <Text style={styles.rowTitle}>Review order</Text>
        <SegmentedControl
          options={ORDER_OPTIONS}
          value={value.reviewSortOrder}
          onChange={(reviewSortOrder) => set({ reviewSortOrder })}
          accessibilityLabel="Review order"
        />
        <Text style={styles.rowHint}>Weakest shows the cards you&apos;re most likely to have forgotten first.</Text>
      </View>
      <View style={[styles.row, styles.rowLine]}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Max reviews a day</Text>
          <Text style={styles.rowHint}>Empty for no limit. Cards you&apos;re learning don&apos;t count.</Text>
        </View>
        <Field
          accessibilityLabel="Maximum reviews per day"
          value={capText}
          onChangeText={(text) => {
            const digits = text.replace(/[^\d]/g, "").slice(0, 4);
            setCapText(digits);
            set({
              maxReviewsPerDay:
                digits === "" ? null : Math.min(MAX_REVIEWS_PER_DAY_LIMIT, Number(digits)),
            });
          }}
          keyboardType="number-pad"
          returnKeyType="done"
          placeholder="None"
          containerStyle={styles.numberField}
        />
      </View>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    stack: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    rowLine: {
      borderTopColor: colors.line,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    rowHint: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary, marginTop: 1 },
    numberField: { width: 84 },
  });
}
