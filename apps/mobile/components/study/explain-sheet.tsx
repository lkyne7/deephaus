import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { MarkdownText } from "@/components/markdown-text";
import { NativeSheet } from "@/components/ui/native-sheet";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** AI explanation of a card, fetched each time the sheet opens. Keep it mounted so it can animate out. */
export function ExplainSheet({
  cardId,
  visible,
  onClose,
}: {
  cardId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplanation(null);

    void (async () => {
      try {
        const data = await api.explainCard(cardId);
        if (!cancelled) setExplanation(data.explanation);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load explanation");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, cardId]);

  return (
    <NativeSheet visible={visible} onClose={onClose} title="Explain" detents={["medium", "large"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subtitle}>A deeper look at this card's concept.</Text>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Generating explanation…</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {explanation && !loading ? <MarkdownText content={explanation} /> : null}
      </ScrollView>
    </NativeSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 40,
      gap: 16,
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    errorText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgError,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 24,
    },
    loadingText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
    },
  });
}
