import type { CommunityDeckDetail } from "@deephaus/api-client";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommunityDeckRelationBadge } from "@/components/ui/community-deck-relation-badge";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { ClozeText } from "@/components/cloze-text";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { cardFontStyle, useCardFont } from "@/lib/study/card-font";
import type { ThemeColors } from "@/lib/theme";
import { plainCardText } from "@/lib/card-preview";
import { useTheme } from "@/lib/theme-context";
import { openDeck } from "@/lib/sections";

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
  const cardFont = cardFontStyle(useCardFont());
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
      // Back from the session should show this deck as yours, not Follow again.
      setPreview((current) =>
        current
          ? {
              ...current,
              is_subscribed: true,
              subscription_sync_mode: mode,
              publication: {
                ...current.publication,
                is_subscribed: true,
                local_project_id: localProjectId,
              },
            }
          : current,
      );
      router.push(`/study/${localProjectId}`);
    } catch (reason) {
      Alert.alert(
        "Subscribe failed",
        reason instanceof Error ? reason.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmUnsubscribe() {
    if (!preview || busy) return;
    Alert.alert(`Unsubscribe from "${preview.publication.title}"?`, "Its cards leave your library.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unsubscribe", style: "destructive", onPress: () => void unsubscribe() },
    ]);
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
        // The deck's title sits in the page on iOS, as on the deck page.
        title={Platform.OS === "ios" ? "" : (preview?.publication.title ?? "Deck preview")}
        backFallback="/community"
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !preview ? (
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="gray" size="lg" />
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
                <CommunityDeckRelationBadge
                  deck={{
                    is_owner: preview.publication.is_owner,
                    is_subscribed: preview.is_subscribed,
                  }}
                />
                <UIText variant="title">{preview.publication.title}</UIText>
                {preview.publication.description ? (
                  <UIText variant="body">{preview.publication.description}</UIText>
                ) : null}
                <View style={styles.meta}>
                  <UIText variant="muted">
                    {`${preview.publication.card_count.toLocaleString()} card${preview.publication.card_count === 1 ? "" : "s"} ·`}
                  </UIText>
                  {preview.publication.published_at ? (
                    <UIText variant="muted">
                      {`${new Date(preview.publication.published_at).toLocaleDateString()} ·`}
                    </UIText>
                  ) : null}
                  <View style={styles.rating}>
                    <Icon name="star" size={13} color={colors.fgTertiary} />
                    <UIText variant="muted">
                      {formatRating(
                        preview.publication.avg_rating,
                        preview.publication.rating_count,
                      )}
                    </UIText>
                  </View>
                </View>
                {!preview.publication.is_owner ? (
                  <View style={styles.ratingRow}>
                    <UIText variant="muted">Your rating</UIText>
                    <StarRating
                      value={preview.publication.my_rating ?? null}
                      onChange={(stars) => void setRating(stars)}
                    />
                    {preview.publication.my_rating != null ? (
                      <Button
                        variant="tertiary"
                        size="sm"
                        label="Clear"
                        accessibilityLabel="Clear rating"
                        textStyle={styles.clearRating}
                        onPress={() => void clearRating()}
                      />
                    ) : null}
                  </View>
                ) : null}
                {preview.publication.is_owner ? (
                  // Your own published deck: go to it rather than subscribe.
                  <View style={styles.actions}>
                    <Button
                      variant="primary"
                      size="lg"
                      label="Open deck"
                      onPress={() => openDeck(preview.publication.source_project_id)}
                      fullWidth
                    />
                  </View>
                ) : (
                  <View style={styles.actions}>
                    {preview.is_subscribed ? (
                      <>
                        {preview.publication.local_project_id ? (
                          <Button
                            variant="primary"
                            size="lg"
                            label="Open deck"
                            onPress={() => openDeck(preview.publication.local_project_id!)}
                            fullWidth
                          />
                        ) : null}
                        <Button
                          variant="secondary"
                          size="lg"
                          label="Unsubscribe"
                          loading={busy}
                          disabled={busy}
                          onPress={confirmUnsubscribe}
                          fullWidth
                        />
                      </>
                    ) : (
                      <>
                        <Button
                          variant="primary"
                          size="lg"
                          label="Follow"
                          leadingIcon="refresh"
                          loading={busy}
                          disabled={busy}
                          onPress={() => void subscribe("follow")}
                          fullWidth
                        />
                        <Button
                          variant="secondary"
                          size="lg"
                          label="Fork"
                          loading={busy}
                          disabled={busy}
                          onPress={() => void subscribe("fork")}
                          fullWidth
                        />
                      </>
                    )}
                  </View>
                )}
                <View style={styles.sampleHead}>
                  <UIText variant="muted">Sample cards</UIText>
                </View>
              </View>
            }
            data={preview.previewCards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item }) => {
              const back = item.type === "basic" && item.back ? plainCardText(item.back) : "";
              return (
                <Card padding={14}>
                  <ClozeText
                    text={
                      item.type === "basic"
                        ? item.front ?? ""
                        : item.cloze_text ?? ""
                    }
                    mode="plain"
                    textStyle={[cardFont, styles.sampleFront]}
                  />
                  {back ? (
                    <>
                      <View style={styles.sampleDivider} />
                      <ClozeText
                        text={back}
                        mode="plain"
                        textStyle={[cardFont, styles.sampleBack]}
                      />
                    </>
                  ) : null}
                </Card>
              );
            }}
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
              color={filled ? colors.accent : colors.fgQuaternary}
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
    list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
    headerContent: { gap: 8 },
    meta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 6,
      rowGap: 4,
    },
    rating: { flexDirection: "row", alignItems: "center", gap: 3 },
    ratingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 6,
    },
    actions: { gap: 8, marginTop: 8 },
    clearRating: { color: colors.accentInk },
    sampleHead: {
      marginTop: 12,
      marginBottom: 2,
      paddingTop: 14,
      borderTopColor: colors.line,
      borderTopWidth: 1,
    },
    sampleFront: { fontSize: 15.5, lineHeight: 22, color: colors.fgPrimary },
    sampleBack: { fontSize: 15.5, lineHeight: 22, color: colors.fgSecondary },
    sampleDivider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  });
}
