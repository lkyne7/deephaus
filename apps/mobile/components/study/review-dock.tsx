import type { ReviewGrade } from "@deephaus/api-client";
import { useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { GradeButton } from "@/components/study/grade-button";
import { Button } from "@/components/ui/button";
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
            <Button
              variant="primary"
              size="xl"
              label="Show answer"
              fullWidth
              onPress={whenEnabled(onReveal)}
            />
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
      padding: 6,
    },
    gradeRow: {
      flexDirection: "row",
      gap: 2,
      height: 64,
    },
    // Same height as the grades, so the card doesn't shift on reveal.
    showAnswerRow: {
      height: 64,
      justifyContent: "center",
      // Even gap around the iOS capsule, inside the dock's capsule.
      paddingHorizontal: Platform.OS === "ios" ? 7 : 0,
    },
    footer: {
      alignItems: "center",
      paddingHorizontal: 8,
      paddingTop: 10,
      minHeight: 34,
    },
  });
}
