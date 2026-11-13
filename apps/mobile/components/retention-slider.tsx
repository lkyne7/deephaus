import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Slider } from "@/components/ui/slider";
import { haptics } from "@/lib/haptics";
import {
  RECOMMENDED_RETENTION_PCT,
  RETENTION_MAX_PCT,
  RETENTION_MIN_PCT,
  retentionHint,
} from "@/lib/study/retention";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * Desired retention as a React Native row: a slider from 70% to 97% with the
 * recommended 90% called out, and a button back to it. Used by the deck
 * settings sheet and Study defaults on Android (iOS Settings uses RetentionSliderRow).
 */
export function RetentionSlider({
  value,
  onChange,
  style,
}: {
  value: number;
  onChange: (pct: number) => void;
  style?: object;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recommended = value === RECOMMENDED_RETENTION_PCT;

  return (
    <View style={[styles.stack, style]}>
      <View style={styles.header}>
        <Text style={styles.title}>Desired retention</Text>
        <Text style={styles.value}>
          {value}%{recommended ? <Text style={styles.badge}> · Recommended</Text> : null}
        </Text>
      </View>
      <Slider
        value={value}
        min={RETENTION_MIN_PCT}
        max={RETENTION_MAX_PCT}
        accessibilityLabel="Desired retention"
        onChange={(pct) => {
          haptics.selection();
          onChange(pct);
        }}
      />
      <View style={styles.footer}>
        <Text style={styles.hint}>{retentionHint(value)}</Text>
        {recommended ? null : (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              haptics.selection();
              onChange(RECOMMENDED_RETENTION_PCT);
            }}
          >
            <Text style={styles.reset}>Use {RECOMMENDED_RETENTION_PCT}%</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    stack: { gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
    header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
    title: { fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    value: { fontSize: 16, lineHeight: 22, color: colors.fgSecondary, fontVariant: ["tabular-nums"] },
    badge: { fontSize: 13, color: colors.fgTertiary },
    footer: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
    hint: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    reset: { fontSize: 13, lineHeight: 18, color: colors.accentInk, fontWeight: "600" },
  });
}
