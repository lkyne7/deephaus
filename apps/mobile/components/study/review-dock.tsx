import type { ReviewGrade } from "@deephaus/api-client";
import { useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GradeButton } from "@/components/study/grade-button";
import { Button } from "@/components/ui/button";
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
  /** Row under the dock: the session's counts. */
  footer?: ReactNode;
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

/** Composer-style dock: Show answer, then the four labelled grades. */
export function ReviewDock({
  revealed,
  disabled,
  intervals,
  onReveal,
  onGrade,
  bottomInset,
  footer,
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
      <View style={[styles.dock, shadows.md]}>
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
      {footer}
    </View>
  );
}

export function ReviewDockFooter({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return <View style={styles.footer}>{children}</View>;
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
      borderRadius: buttonRadius,
      padding: DOCK_PADDING,
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
      borderRadius: (ROW_HEIGHT - SHOW_ANSWER_INSET * 2) / 2,
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
    footer: {
      alignItems: "center",
      paddingHorizontal: 8,
      paddingTop: 10,
      minHeight: 34,
    },
  });
}
