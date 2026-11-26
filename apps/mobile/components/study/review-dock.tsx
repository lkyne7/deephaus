import type { ReviewGrade } from "@deephaus/api-client";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { GradeButton } from "@/components/study/grade-button";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon-names";
import { PressableScale } from "@/components/ui/pressable-scale";
import { buttonRadius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export const REVIEW_GRADES: Array<{ id: ReviewGrade; label: string }> = [
  { id: "again", label: "Again" },
  { id: "hard", label: "Hard" },
  { id: "good", label: "Good" },
  { id: "easy", label: "Easy" },
];

export function gradeColor(colors: ThemeColors, grade: ReviewGrade) {
  return {
    again: colors.gradeAgain,
    hard: colors.gradeHard,
    good: colors.gradeGood,
    easy: colors.gradeEasy,
  }[grade];
}

type Props = {
  revealed: boolean;
  disabled: boolean;
  intervals: Record<ReviewGrade, string>;
  onReveal: () => void;
  onGrade: (grade: ReviewGrade) => void;
  bottomInset: number;
  /** Opens inside the dock, above the tools: the hint. */
  panel?: ReactNode;
  /** Row inside the dock, right above Show answer and the grades. */
  tools?: ReactNode;
};

/** The dock's inner padding and the row's height, which together set the even gap. */
const DOCK_PADDING = 6;
const ROW_HEIGHT = 64;
/**
 * Show answer's inset within its row on iOS. With the dock's padding it leaves
 * the same gap on every side of the capsule, so the two capsules' curves are
 * concentric (the dock's radius is the button's plus the gap).
 */
const SHOW_ANSWER_INSET = 7;
const SHOW_ANSWER_RADIUS = (ROW_HEIGHT - SHOW_ANSWER_INSET * 2) / 2;
/** Taller than one row, the dock rounds its corners around Show answer's instead of being a pill. */
const TALL_DOCK_RADIUS =
  Platform.OS === "ios" ? SHOW_ANSWER_RADIUS + SHOW_ANSWER_INSET + DOCK_PADDING : buttonRadius;
const TOOL_ROW_HEIGHT = 44;

/** Composer-style dock: the tools, then Show answer or the four labelled grades. */
export function ReviewDock({
  revealed,
  disabled,
  intervals,
  onReveal,
  onGrade,
  bottomInset,
  panel,
  tools,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // `disabled` flips on every grade while the save runs, so gate presses here
  // rather than disabling the system buttons, which would dim between cards.
  const whenEnabled = (action: () => void) => () => {
    if (!disabled) action();
  };

  return (
    <View style={[styles.shell, { paddingBottom: Math.max(bottomInset, 12) }]}>
      <View
        style={[
          styles.dock,
          shadows.md,
          { borderRadius: panel || tools ? TALL_DOCK_RADIUS : buttonRadius },
        ]}
      >
        {panel ? <View style={styles.panel}>{panel}</View> : null}
        {tools}
        {revealed ? (
          <View style={styles.gradeRow}>
            {REVIEW_GRADES.map((g) => (
              <GradeButton
                key={g.id}
                label={g.label}
                interval={intervals[g.id]}
                color={gradeColor(colors, g.id)}
                onPress={whenEnabled(() => onGrade(g.id))}
              />
            ))}
          </View>
        ) : (
          <View style={styles.showAnswerRow}>
            {Platform.OS === "ios" ? (
              // Drawn here rather than as a system button: iOS 26 draws a
              // large prominent button as a rounded rectangle whatever shape
              // is asked for, which left the gap wider at its corners.
              <PressableScale
                scaleTo={0.98}
                accessibilityRole="button"
                onPress={whenEnabled(onReveal)}
                style={styles.showAnswer}
              >
                <Text style={styles.showAnswerLabel}>Show answer</Text>
              </PressableScale>
            ) : (
              <Button
                variant="primary"
                size="xl"
                label="Show answer"
                fullWidth
                onPress={whenEnabled(onReveal)}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

type ToolButtonProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Its panel is open. */
  active?: boolean;
  accessibilityLabel?: string;
};

/**
 * Undo on the left, Hint or Explain on the right, `center` (the session's
 * counts) between. Both sides are kept as wide as the widest label either
 * button can show, so the counts stay centred when Hint turns into Explain.
 */
export function ReviewDockTools({
  start,
  end,
  center,
}: {
  start: ToolButtonProps;
  end: ToolButtonProps & { /** Every label `end` can show; the sides reserve the widest. */ labels: string[] };
  center: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [sideWidth, setSideWidth] = useState(0);
  // A width can only grow: a narrower measurement after a font-size change
  // would otherwise leave the sides wider than they need, never cut off.
  const measure = useCallback((event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setSideWidth((current) => (width > current ? width : current));
  }, []);

  return (
    <View style={styles.toolRow}>
      {/* Every label either button can show, laid out unseen to size the sides. */}
      <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[{ icon: start.icon, label: start.label }, ...end.labels.map((label) => ({ icon: end.icon, label }))].map(
          (item) => (
            <View key={item.label} style={styles.toolButton} onLayout={measure}>
              <Icon name={item.icon} size={17} />
              <Text style={styles.toolLabel} maxFontSizeMultiplier={TOOL_FONT_MAX}>
                {item.label}
              </Text>
            </View>
          ),
        )}
      </View>
      <View style={[styles.toolSide, { width: sideWidth, alignItems: "flex-start" }]}>
        <ToolButton {...start} />
      </View>
      <View style={styles.toolCenter}>{center}</View>
      <View style={[styles.toolSide, { width: sideWidth, alignItems: "flex-end" }]}>
        <ToolButton {...end} />
      </View>
    </View>
  );
}

const TOOL_FONT_MAX = 1.3;

function ToolButton({ icon, label, onPress, disabled, active, accessibilityLabel }: ToolButtonProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, expanded: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      style={[styles.toolButton, active && styles.toolButtonActive, disabled && styles.toolButtonDisabled]}
    >
      <Icon name={icon} size={17} color={colors.fgPrimary} />
      <Text style={styles.toolLabel} numberOfLines={1} maxFontSizeMultiplier={TOOL_FONT_MAX}>
        {label}
      </Text>
    </PressableScale>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    shell: {
      flexShrink: 0,
      paddingHorizontal: 12,
      paddingTop: 8,
      backgroundColor: colors.bgCanvas,
    },
    dock: {
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: 1,
      padding: DOCK_PADDING,
    },
    panel: {
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 12,
      marginBottom: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    toolRow: {
      height: TOOL_ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 2,
    },
    measure: {
      position: "absolute",
      opacity: 0,
      flexDirection: "row",
    },
    toolSide: {
      flexShrink: 0,
      justifyContent: "center",
    },
    toolCenter: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      paddingHorizontal: 4,
    },
    toolButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 40,
      paddingLeft: 10,
      paddingRight: 12,
      borderRadius: 20,
    },
    toolButtonActive: {
      backgroundColor: colors.bgSunken,
    },
    toolButtonDisabled: {
      opacity: 0.4,
    },
    toolLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    gradeRow: {
      flexDirection: "row",
      gap: 2,
      height: ROW_HEIGHT,
    },
    // Same height as the grades, so the card doesn't shift on reveal.
    showAnswerRow: {
      height: ROW_HEIGHT,
      justifyContent: "center",
      padding: Platform.OS === "ios" ? SHOW_ANSWER_INSET : 0,
    },
    showAnswer: {
      flex: 1,
      borderRadius: SHOW_ANSWER_RADIUS,
      backgroundColor: colors.actionPrimaryBg,
      alignItems: "center",
      justifyContent: "center",
    },
    showAnswerLabel: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.actionPrimaryFg,
    },
  });
}
