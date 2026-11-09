import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NativeStudyPicker } from "@/components/home/native-study-picker";
import {
  fullCount,
  shortCount,
  type StudyPickerProps,
} from "@/components/home/study-picker-types";
import { liquidGlassAvailable } from "@/components/ui/glass-surface";
import { Icon } from "@/components/ui/icon";
import { NativeMenu } from "@/components/ui/native-menu";
import { PressableScale } from "@/components/ui/pressable-scale";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type { StudyPickerProps };

/**
 * Home's one way into studying: pick a deck, see what's waiting in it, tap
 * Study. System glass controls on iOS 26, React Native pills elsewhere.
 */
export function StudyPicker(props: StudyPickerProps) {
  return liquidGlassAvailable ? <NativeStudyPicker {...props} /> : <PillStudyPicker {...props} />;
}

function PillStudyPicker({ decks, selected, onSelect, onStudy }: StudyPickerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <NativeMenu
        label="Study a deck"
        entries={[
          {
            title: "Study a deck",
            items: decks.map((deck) => ({
              label: `${deck.title} (${fullCount(deck)})`,
              selected: deck.id === selected.id,
              onPress: () => onSelect(deck),
            })),
          },
        ]}
        style={styles.pickerTrigger}
      >
        <View
          style={styles.picker}
          accessibilityLabel={`Deck: ${selected.title}, ${fullCount(selected)}`}
        >
          <Icon name="layers" size={15} color={colors.fgTertiary} />
          <Text style={styles.name} numberOfLines={1}>
            {selected.title}
          </Text>
          <Text style={styles.count}>{shortCount(selected)}</Text>
          <Icon name="arrowDown" size={13} color={colors.fgTertiary} />
        </View>
      </NativeMenu>
      <PressableScale
        onPress={onStudy}
        accessibilityRole="button"
        accessibilityLabel={`Study ${selected.title}`}
        style={styles.study}
      >
        <Icon name="play" size={13} color={colors.actionBrandFg} />
        <Text style={styles.studyLabel}>Study</Text>
      </PressableScale>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      maxWidth: "100%",
    },
    pickerTrigger: { flexShrink: 1, minWidth: 0 },
    picker: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    name: {
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    count: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    study: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.actionBrandBg,
    },
    studyLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      color: colors.actionBrandFg,
    },
  });
}
