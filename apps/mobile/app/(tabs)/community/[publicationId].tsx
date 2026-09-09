import type { CommunityDeckDetail } from "@deephaus/api-client";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommunityDeckRelationBadge } from "@/components/ui/community-deck-relation-badge";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { communityDeckLogoKind, DeckLogo } from "@/components/ui/deck-logo";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { ClozeText } from "@/components/cloze-text";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

function formatRating(avg: number | undefined, count: number | undefined) {
  if (!count) return "No ratings";
  return `${(avg ?? 0).toFixed(1)} (${count})`;
}

export default function CommunityPreviewScreen() {
  const { publicationId } = useLocalSearchParams<{
    publicationId: string;
  }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [preview, setPreview] = useState<CommunityDeckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicationId) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.getCommunityDeck(publicationId));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load this deck.",
      );
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function subscribe(mode: "follow" | "fork") {
    if (!preview) return;
    setBusy(true);
    try {
      const { localProjectId } = await api.subscribeCommunityDeck(
        preview.publication.id,
        mode,
      );
      haptics.success();
      router.replace(`/(tabs)/study/${localProjectId}`);
    } catch (reason) {
      Alert.alert(
        "Subscribe failed",
        reason instanceof Error ? reason.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    if (!preview) return;
    setBusy(true);
    try {
      await api.unsubscribeCommunityDeck(preview.publication.id);
      haptics.success();
      setPreview((current) =>
        current
          ? {
              ...current,
              is_subscribed: false,
              subscription_sync_mode: null,
              publication: {
                ...current.publication,
                is_subscribed: false,
                subscription_sync_mode: null,
              },
            }
          : current,
      );
    } catch (reason) {
      Alert.alert(
        "Unsubscribe failed",
        reason instanceof Error ? reason.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function setRating(stars: number) {
    if (!preview || preview.publication.is_owner) return;
    try {
      const next = await api.rateCommunityDeck(preview.publication.id, stars);
      haptics.selection();
      setPreview((current) =>
        current
          ? {
              ...current,
              my_rating: next.my_rating,
              publication: {
                ...current.publication,
                my_rating: next.my_rating,
                avg_rating: next.avg_rating,
                rating_count: next.rating_count,
              },
            }
          : current,
      );
    } catch (reason) {
      Alert.alert(
        "Rating failed",
        reason instanceof Error ? reason.message : "Unknown error",
      );
    }
  }

  async function clearRating() {
    if (!preview) return;
    try {
      const next = await api.clearCommunityDeckRating(preview.publication.id);
      haptics.selection();
      setPreview((current) =>
        current
          ? {
              ...current,
              my_rating: next.my_rating,
              publication: {
                ...current.publication,
                my_rating: next.my_rating,
                avg_rating: next.avg_rating,
                rating_count: next.rating_count,
              },
            }
          : current,
      );
    } catch (reason) {
      Alert.alert(
        "Rating failed",
        reason instanceof Error ? reason.message : "Unknown error",
      );
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={preview?.publication.title ?? "Deck preview"}
        backFallback="/(tabs)/community"
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : error || !preview ? (
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="orange" size="lg" />
          <UIText variant="muted" style={styles.errorText}>
            {error ?? "Deck not found."}
          </UIText>
          <Button
            variant="secondary"
            label="Try again"
            onPress={() => void load()}
          />
        </View>
      ) : (
        <>
          <FlatList
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View style={styles.headerContent}>
                <Card padding={16} style={{ gap: 8 }}>
                  <View style={styles.titleRow}>
                    <DeckLogo kind={communityDeckLogoKind(preview.publication)} />
                    <UIText variant="title" style={styles.previewTitle}>
                      {preview.publication.title}
                    </UIText>
                  </View>
                  {preview.publication.description ? (
                    <UIText variant="muted" style={styles.description}>
                      {preview.publication.description}
                    </UIText>
                  ) : null}
                  <View style={styles.badges}>
                    <BadgePill
                      icon="layers"
                      label={`${preview.previewCards.length}+ cards`}
                      tone="brand"
                    />
                    {preview.publication.published_at ? (
                      <BadgePill
                        icon="calendar"
                        label={new Date(
                          preview.publication.published_at,
                        ).toLocaleDateString()}
                        tone="gray"
                      />
                    ) : null}
                    <BadgePill
                      icon="star"
                      label={formatRating(
                        preview.publication.avg_rating,
                        preview.publication.rating_count,
                      )}
                      tone="gray"
                    />
                    <CommunityDeckRelationBadge
                      deck={{
                        is_owner: preview.publication.is_owner,
                        is_subscribed: preview.is_subscribed,
                      }}
                    />
                  </View>
                  {!preview.publication.is_owner ? (
                    <View style={styles.ratingRow}>
                      <UIText variant="muted">Your rating</UIText>
                      <StarRating
                        value={preview.publication.my_rating ?? null}
                        onChange={(stars) => void setRating(stars)}
                      />
                      {preview.publication.my_rating != null ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Clear rating"
                          hitSlop={6}
                          onPress={() => void clearRating()}
                        >
                          <Text style={styles.clearRating}>Clear</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {!preview.publication.is_owner ? (
                    <View style={styles.actions}>
                      {preview.is_subscribed ? (
                        <Button
                          variant="secondary"
                          size="md"
                          label="Unsubscribe"
                          loading={busy}
                          disabled={busy}
                          onPress={() => void unsubscribe()}
                          style={{ flex: 1 }}
                        />
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            size="md"
                            label="Fork"
                            loading={busy}
                            disabled={busy}
                            onPress={() => void subscribe("fork")}
                            style={{ flex: 1 }}
                          />
                          <Button
                            variant="brand"
                            size="md"
                            label="Follow"
                            leadingIcon="refresh"
                            loading={busy}
                            disabled={busy}
                            onPress={() => void subscribe("follow")}
                            style={{ flex: 1 }}
                          />
                        </>
                      )}
                    </View>
                  ) : null}
                </Card>
                <UIText variant="label" style={styles.sectionTitle}>
                  Sample cards
                </UIText>
              </View>
            }
            data={preview.previewCards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item }) => (
              <Card padding={14}>
                <ClozeText
                  text={
                    item.type === "basic"
                      ? item.front ?? ""
                      : item.cloze_text ?? ""
                  }
                  mode="plain"
                  textStyle={{
                    fontSize: 14,
                    lineHeight: 20,
                    color: colors.fgPrimary,
                  }}
                />
              </Card>
            )}
          />
        </>
      )}
    </View>
  );
}

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (stars: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value != null && star <= value;
        return (
          <Pressable
            key={star}
            accessibilityRole="button"
            accessibilityLabel={`${star} star${star === 1 ? "" : "s"}`}
            hitSlop={4}
            onPress={() => onChange(star)}
          >
            <Icon
              name={filled ? "star" : "starOutline"}
              size={22}
              color={filled ? colors.brand500 : colors.fgQuaternary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 24,
    },
    errorText: { textAlign: "center" },
    list: { padding: 16, gap: 8, paddingBottom: 32 },
    headerContent: { gap: 12 },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    previewTitle: { flex: 1, minWidth: 0 },
    description: { fontSize: 14, lineHeight: 20 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    ratingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    actions: { flexDirection: "row", gap: 8, marginTop: 4 },
    clearRating: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.brand600,
    },
    sectionTitle: {
      color: colors.fgQuaternary,
      paddingHorizontal: 4,
    },
  });
}
