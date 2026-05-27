import type { ReviewCardPayload, ReviewGrade } from "@deephaus/api-client";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RichCardContent } from "@/components/rich-card-content";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MutedText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";

const GRADES: Array<{ id: ReviewGrade; label: string; color: string }> = [
  { id: "again", label: "Again", color: theme.colors.gradeAgain },
  { id: "hard", label: "Hard", color: theme.colors.gradeHard },
  { id: "good", label: "Good", color: theme.colors.gradeGood },
  { id: "easy", label: "Easy", color: theme.colors.gradeEasy },
];

type HistoryEntry = {
  cardIndex: number;
  card: ReviewCardPayload;
  grade: ReviewGrade;
  previousState: Record<string, unknown> | null;
  nextState: Record<string, unknown>;
  log: Record<string, unknown>;
};

export default function StudySessionScreen() {
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const [queue, setQueue] = useState<ReviewCardPayload[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deckName, setDeckName] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });

  const current = queue[index] ?? null;

  const loadQueue = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    try {
      const data = await api.getStudyQueue(deckId, { limit: 50 });
      setQueue(data.cards);
      setDeckName(data.deck.name);
      setIndex(0);
      setRevealed(false);
      setHistory([]);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
    } catch (e) {
      Alert.alert("Study failed", e instanceof Error ? e.message : "Could not load queue");
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function grade(gradeId: ReviewGrade) {
    if (!current) return;
    const gradedIndex = index;
    const gradedCard = current;
    setRevealed(false);
    setStats((s) => ({ ...s, [gradeId]: s[gradeId] + 1 }));
    if (gradedIndex + 1 >= queue.length) {
      setIndex(queue.length);
    } else {
      setIndex(gradedIndex + 1);
    }

    try {
      const response = await api.submitReview(current.id, {
        grade: gradeId,
        cloze_ord: current.cloze_ord ?? undefined,
      });
      setHistory((h) => [
        ...h,
        {
          cardIndex: gradedIndex,
          card: gradedCard,
          grade: gradeId,
          previousState: (response.previous_state as Record<string, unknown> | null) ?? null,
          nextState: (response.next_state as Record<string, unknown>) ?? {},
          log: (response.log as Record<string, unknown>) ?? {},
        },
      ]);
      const updatedIntervals = (response.intervals ?? gradedCard.intervals) as ReviewCardPayload["intervals"];
      setQueue((q) => {
        const next = [...q];
        next[gradedIndex] = { ...gradedCard, intervals: updatedIntervals };
        return next;
      });
    } catch (e) {
      setStats((s) => ({ ...s, [gradeId]: Math.max(0, s[gradeId] - 1) }));
      setIndex(gradedIndex);
      setRevealed(true);
      Alert.alert("Grade failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function undo() {
    const entry = history[history.length - 1];
    if (!entry) return;
    try {
      await api.restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.previousState,
        log_action: "delete_latest",
      });
      setHistory((h) => h.slice(0, -1));
      setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
      setIndex(entry.cardIndex);
      setRevealed(true);
    } catch (e) {
      Alert.alert("Undo failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.container}>
        <Card style={styles.completeCard}>
          <Text style={styles.completeTitle}>Session complete</Text>
          <MutedText>{deckName}</MutedText>
          <Text style={styles.statsLine}>
            Again {stats.again} · Hard {stats.hard} · Good {stats.good} · Easy {stats.easy}
          </Text>
          <Button label="Study again" onPress={() => void loadQueue()} />
          <Button label="Back to decks" variant="secondary" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  const activeCloze = current.cloze_ord ?? undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <MutedText>
          {index + 1} / {queue.length}
        </MutedText>
        <Pressable onPress={() => void undo()} disabled={history.length === 0}>
          <Text style={[styles.undo, history.length === 0 && styles.disabled]}>Undo</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => setRevealed(true)}>
        <Card style={styles.cardPanel}>
          {current.type === "basic" ? (
            <>
              <RichCardContent content={current.front} studyView style={{ minHeight: 80 }} />
              {revealed && (
                <>
                  <Text style={styles.divider}>Answer</Text>
                  <RichCardContent content={current.back} studyView style={{ minHeight: 80 }} />
                </>
              )}
            </>
          ) : (
            <RichCardContent
              content={current.cloze_text}
              clozeMode={revealed ? "revealed" : "hidden"}
              activeClozeOrd={activeCloze}
              studyView
              style={{ minHeight: 100 }}
            />
          )}
          {current.extra && revealed && (
            <RichCardContent content={current.extra} studyView style={{ minHeight: 40 }} />
          )}
          {!revealed && <MutedText style={styles.tapHint}>Tap to reveal</MutedText>}
        </Card>
      </Pressable>

      {revealed && (
        <View style={styles.gradeRow}>
          {GRADES.map((g) => (
            <Pressable
              key={g.id}
              style={[styles.gradeBtn, { borderColor: g.color }]}
              onPress={() => void grade(g.id)}
            >
              <Text style={[styles.gradeLabel, { color: g.color }]}>{g.label}</Text>
              <Text style={styles.interval}>{current.intervals[g.id]}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  center: { flex: 1, justifyContent: "center", backgroundColor: theme.colors.background },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  undo: { color: theme.colors.accent, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  cardPanel: { gap: 12, minHeight: 180 },
  divider: { color: theme.colors.muted, fontWeight: "700", marginTop: 8 },
  tapHint: { textAlign: "center", marginTop: 8 },
  gradeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gradeBtn: {
    flexGrow: 1,
    minWidth: "45%",
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 12,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    gap: 4,
  },
  gradeLabel: { fontWeight: "700", fontSize: 16 },
  interval: { color: theme.colors.muted, fontSize: 12 },
  completeCard: { gap: 12, margin: 16 },
  completeTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "700" },
  statsLine: { color: theme.colors.text },
});
