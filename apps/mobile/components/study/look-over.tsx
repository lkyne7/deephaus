import { missNote, type SittingMiss } from "@deephaus/shared";
import { usePreventRemove } from "expo-router/react-navigation";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExplainSheet } from "@/components/study/explain-sheet";
import { StudyCardContent } from "@/components/study/study-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ProgressBar } from "@/components/ui/progress-bar";
import { haptics } from "@/lib/haptics";
import type { SessionCard } from "@/lib/study/session";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * The cards missed, question and answer together, with Explain and Fix card
 * beside them. Nothing is graded or rescheduled.
 */
export function LookOver({
  misses,
  fontScale,
  onCardUpdated,
  onFinish,
}: {
  misses: SittingMiss<SessionCard>[];
  fontScale: number;
  onCardUpdated: (updated: Partial<StudyCardFields> & { id: string }) => void;
  onFinish: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [panel, setPanel] = useState<"explain" | "edit" | null>(null);
  // Back returns to the finish page, not out of the session.
  usePreventRemove(true, onFinish);
  const miss = misses[Math.min(index, misses.length - 1)];
  const last = index >= misses.length - 1;
  if (!miss) return null;

  return (
    <View style={styles.root}>
      <ProgressBar value={(index + 1) / misses.length} height={2} style={styles.progress} />
      <ScrollView
        key={miss.key}
        style={{ flex: 1 }}
        contentContainerStyle={styles.card}
        showsVerticalScrollIndicator={false}
      >
        <StudyCardContent card={miss.card} revealed fontScale={fontScale} />
        <Text style={styles.note}>{missNote(miss, miss.card.lapses)}</Text>
      </ScrollView>
      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.tools}>
          <View style={styles.tool}>
            <Button
              variant="secondary"
              size="lg"
              label="Explain"
              fullWidth
              onPress={() => setPanel("explain")}
            />
          </View>
          <View style={styles.tool}>
            <Button
              variant="secondary"
              size="lg"
              label="Fix card"
              fullWidth
              onPress={() => setPanel("edit")}
            />
          </View>
        </View>
        <PressableScale
          scaleTo={0.98}
          accessibilityRole="button"
          onPress={() => {
            haptics.light();
            if (last) onFinish();
            else setIndex(index + 1);
          }}
          style={styles.primary}
        >
          <Text style={styles.primaryLabel}>
            {last ? "Finish" : "Next card"}
            <Text style={styles.primaryDetail}>
              {"  "}
              {index + 1} of {misses.length}
            </Text>
          </Text>
        </PressableScale>
        <Text style={styles.fine}>Nothing is graded or rescheduled here.</Text>
      </View>
      <ExplainSheet
        card={miss.card}
        visible={panel === "explain"}
        onClose={() => setPanel(null)}
        onCardFixed={onCardUpdated}
      />
      {panel === "edit" ? (
        <StudyCardPanel card={miss.card} onClose={() => setPanel(null)} onSaved={onCardUpdated} />
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    progress: { borderRadius: 0 },
    card: { flexGrow: 1, paddingTop: 44, paddingBottom: 24, paddingHorizontal: 24 },
    note: {
      marginTop: 32,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 18,
      overflow: "hidden",
      backgroundColor: colors.bgSunken,
      color: colors.fgSecondary,
      fontSize: 15,
      lineHeight: 20,
      textAlign: "center",
    },
    dock: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
    tools: { flexDirection: "row", gap: 8 },
    tool: { flex: 1 },
    primary: {
      minHeight: 56,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.actionPrimaryBg,
    },
    primaryLabel: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: colors.actionPrimaryFg },
    primaryDetail: { fontSize: 15, fontWeight: "400" },
    fine: { fontSize: 13, lineHeight: 18, textAlign: "center", color: colors.fgTertiary },
  });
}
