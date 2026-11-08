import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import {
  FOCUS_PRESET_OPTIONS,
  QUALITY_LEVEL_OPTIONS,
  qualityLevelCreditsLabel,
  type DetailLevel,
  type QualityLevel,
} from "@deephaus/shared";
import { Icon } from "@/components/ui/icon";
import { NativeSheet } from "@/components/ui/native-sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { CardTypeChoice, CreateOptions } from "@/lib/create-options";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const DETAIL_OPTIONS: { value: DetailLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const CARD_TYPE_OPTIONS: { value: CardTypeChoice; label: string }[] = [
  { value: "basic", label: "Front/Back" },
  { value: "cloze", label: "Fill-in" },
  { value: "both", label: "Both" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  options: CreateOptions;
  onChange: (options: CreateOptions) => void;
};

/** Card settings live in a sheet, where the keyboard can't hide them. */
export function CardOptionsSheet({ visible, onClose, options, onChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const quality =
    QUALITY_LEVEL_OPTIONS.find((option) => option.value === options.qualityLevel) ??
    QUALITY_LEVEL_OPTIONS[1];

  return (
    <NativeSheet visible={visible} onClose={onClose} title="Card options" detents={["large"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.label}>Detail</Text>
          <SegmentedControl<DetailLevel>
            options={DETAIL_OPTIONS}
            value={options.detailLevel}
            onChange={(detailLevel) => onChange({ ...options, detailLevel })}
            accessibilityLabel="Detail"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Quality</Text>
          <SegmentedControl<QualityLevel>
            options={QUALITY_LEVEL_OPTIONS}
            value={options.qualityLevel}
            onChange={(qualityLevel) => onChange({ ...options, qualityLevel })}
            accessibilityLabel="Quality"
          />
          <Text style={styles.footnote}>
            {quality.description} {qualityLevelCreditsLabel(quality.value)}.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Card type</Text>
          <SegmentedControl<CardTypeChoice>
            options={CARD_TYPE_OPTIONS}
            value={options.cardType}
            onChange={(cardType) => onChange({ ...options, cardType })}
            accessibilityLabel="Card type"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Focus</Text>
          <View style={styles.group}>
            {FOCUS_PRESET_OPTIONS.map((option, index) => {
              const active = option.value === options.focusPreset;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onChange({ ...options, focusPreset: option.value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowLine,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{option.label}</Text>
                    <Text style={styles.rowDescription}>{option.description}</Text>
                  </View>
                  {active ? <Icon name="check" size={17} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, styles.rowText]}>Tag cards automatically</Text>
            <Switch
              value={options.autoTags}
              onValueChange={(autoTags) => onChange({ ...options, autoTags })}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Tag cards automatically"
            />
          </View>
        </View>

        <Text style={styles.footnote}>Your choices stay for next time.</Text>
      </ScrollView>
    </NativeSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { gap: 16, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
    section: { gap: 6 },
    label: {
      paddingLeft: 4,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    group: {
      borderRadius: radius.xl4,
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    rowLine: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
    rowText: { flex: 1, minWidth: 0 },
    rowLabel: { fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    rowDescription: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    footnote: { paddingLeft: 4, fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    pressed: { opacity: 0.6 },
  });
}
