import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import {
  explainErrorMessage,
  hasExplainContent,
  readSavedExplanation,
  writeExplanation,
  type ExplainCard,
} from "@/lib/study/explain";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * Up to three hints, one at a time, floating above the dock before the answer
 * is shown. Saved hints reopen free; the first set costs 1 credit.
 */
export function HintCard({ card, onClose }: { card: ExplainCard; onClose: () => void }) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [hints, setHints] = useState<string[]>([]);
  const [shown, setShown] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHints([]);
    setShown(1);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        let state = await readSavedExplanation(card, "hint");
        if (!hasExplainContent(state, "hint")) state = await writeExplanation(card, "hint");
        if (!cancelled) setHints(state?.hints ?? []);
      } catch (err) {
        if (!cancelled) setError(await explainErrorMessage(err, "write"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the card and the ordinal being studied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.cloze_ord]);

  return (
    <View style={[styles.card, shadows.lg]} accessibilityLiveRegion="polite">
      <View style={styles.header}>
        <Icon name="lightbulb" size={16} color={colors.accentInk} />
        <Text style={styles.title}>
          {hints.length > 0 ? `Hint ${Math.min(shown, hints.length)} of ${hints.length}` : "Hint"}
        </Text>
        <Pressable
          onPress={onClose}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Close hint"
          hitSlop={8}
        >
          <Icon name="close" size={13} color={colors.fgTertiary} />
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Writing hints…</Text>
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          <Text style={styles.hint}>{hints[shown - 1]}</Text>
          {shown < hints.length ? (
            <Pressable
              style={styles.more}
              onPress={() => {
                haptics.selection();
                setShown((n) => n + 1);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.moreText}>Another hint</Text>
            </Pressable>
          ) : (
            <Text style={styles.muted}>That's every hint. Reveal when you're ready.</Text>
          )}
        </>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      marginHorizontal: 12,
      marginBottom: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 10,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "600", color: colors.fgPrimary },
    close: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bgSunken,
    },
    hint: { ...serifFont(400), fontSize: 17, lineHeight: 25, color: colors.fgPrimary },
    more: {
      alignSelf: "flex-start",
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 17,
      justifyContent: "center",
      backgroundColor: colors.bgSunken,
    },
    moreText: { fontSize: 14, fontWeight: "500", color: colors.fgPrimary },
    loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    muted: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    error: { fontSize: 13, lineHeight: 18, color: colors.fgError },
  });
}
