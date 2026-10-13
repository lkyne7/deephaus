import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { cardTypeBadgeTone, cardTypeLabel } from "@deephaus/shared";
import { BadgePill } from "@/components/ui/badge-pill";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { RichCardContent } from "@/components/rich-card-content";
import { api } from "@/lib/api";
import { useBackgroundTasks } from "@/lib/background-tasks-context";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DraftCard } from "@deephaus/shared";

export default function ReviewScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, job_id } = useLocalSearchParams<{ id: string; job_id: string }>();
  const [cards, setCards] = useState<DraftCard[] | null>(null);
  const { startAnkiExport, tasks } = useBackgroundTasks();
  const exporting = tasks.some(
    (task) => task.kind === "anki-export" && task.status === "running" && task.projectId === id,
  );

  useEffect(() => {
    if (!job_id) return;
    void api
      .listCards(job_id)
      .then(setCards)
      .catch(() => setCards([]));
  }, [job_id]);

  function exportDeck() {
    if (!id || !job_id) return;
    // Packaged in the background; the share sheet opens once the file has downloaded.
    startAnkiExport(id, "Generated cards", { jobId: job_id });
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Review cards"
        backFallback="/(tabs)/create"
        actions={[
          {
            icon: "share",
            sfIcon: "square.and.arrow.up",
            label: exporting ? "Exporting deck" : "Share deck",
            loading: exporting,
            disabled: cards?.length === 0,
            onPress: () => void exportDeck(),
          },
        ]}
      />

      {cards === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <>
          <FlatList
            data={cards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View style={styles.summary}>
                <BadgePill
                  icon="check"
                  label={`${cards.length} card${cards.length === 1 ? "" : "s"} generated`}
                  tone="brand"
                />
                <Text style={styles.summaryTitle}>Review and save</Text>
                <Text style={styles.summarySub}>
                  Cards added to your deck on save. Use Share to export as .apkg.
                </Text>
              </View>
            }
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item, index }) => (
              <Card padding={14} style={{ gap: 8 }}>
                <View style={styles.cardHeader}>
                  <View style={styles.numberPill}>
                    <Text style={styles.numberText}>{index + 1}</Text>
                  </View>
                  <BadgePill
                    label={cardTypeLabel(item.type, "short")}
                    tone={cardTypeBadgeTone(item.type)}
                  />
                </View>
                {item.type === "basic" ? (
                  <>
                    <RichCardContent content={item.front} />
                    {item.back && (
                      <>
                        <View style={styles.divider} />
                        <RichCardContent content={item.back} />
                      </>
                    )}
                  </>
                ) : (
                  <RichCardContent content={item.cloze_text} />
                )}
                {item.extra && (
                  <Text style={styles.extra} numberOfLines={2}>
                    {item.extra}
                  </Text>
                )}
              </Card>
            )}
            ListEmptyComponent={
              <Card padding={20} style={styles.empty}>
                <FeaturedIcon icon="warning" variant="orange" size="lg" />
                <Text style={styles.emptyTitle}>No cards yet</Text>
                <Text style={styles.emptyBody}>
                  Generation produced no draft cards. Try again with more detail.
                </Text>
              </Card>
            }
          />

        </>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    summary: {
      paddingBottom: 16,
      gap: 8,
    },
    summaryTitle: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.3,
      marginTop: 6,
    },
    summarySub: {
      fontSize: 14,
      color: colors.fgTertiary,
    },
    listContent: {
      padding: 16,
      paddingBottom: 96,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    numberPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      backgroundColor: colors.gray50,
      borderColor: colors.gray200,
      borderWidth: 1,
      borderRadius: 6,
    },
    numberText: {
      fontSize: 11,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    divider: { height: 1, backgroundColor: colors.borderSecondary },
    extra: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgQuaternary,
    },
    empty: { alignItems: "center", gap: 4 },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
  });
}
