import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { PageHeader } from "@/components/ui/page-header";
import { RichCardContent } from "@/components/rich-card-content";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DraftCard } from "@deephaus/shared";

export default function ReviewScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, job_id } = useLocalSearchParams<{ id: string; job_id: string }>();
  const [cards, setCards] = useState<DraftCard[] | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!job_id) return;
    void api
      .listCards(job_id)
      .then(setCards)
      .catch(() => setCards([]));
  }, [job_id]);

  async function exportDeck() {
    if (!id || !job_id) return;
    setExporting(true);
    try {
      const blob = await api.exportDeck(id, job_id);
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const path = `${FileSystem.cacheDirectory}deephaus-deck.apkg`;
        await FileSystem.writeAsStringAsync(path, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, {
            mimeType: "application/octet-stream",
            dialogTitle: "Export Anki deck",
          });
        } else {
          Alert.alert("Exported", `Saved to ${path}`);
        }
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.root}>
      <PageHeader title="Review cards" onBack={() => router.back()} />

      {cards === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <>
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

          <FlatList
            data={cards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item, index }) => (
              <Card padding={14} style={{ gap: 8 }}>
                <View style={styles.cardHeader}>
                  <View style={styles.numberPill}>
                    <Text style={styles.numberText}>{index + 1}</Text>
                  </View>
                  <BadgePill
                    label={item.type === "basic" ? "Front/Back" : "Cloze"}
                    tone="gray"
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

          <View style={styles.footer}>
            <Button
              variant="brand"
              size="lg"
              label={exporting ? "Exporting…" : "Share .apkg"}
              leadingIcon="share"
              loading={exporting}
              disabled={exporting || cards.length === 0}
              onPress={() => void exportDeck()}
              fullWidth
            />
          </View>
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
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
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
    footer: {
      padding: 16,
      backgroundColor: colors.bgSurface,
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
    },
  });
}
