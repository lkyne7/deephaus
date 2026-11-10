import type { CommunityDeckCard, CommunityDeckDetail, SyncMode } from "@deephaus/api-client";
import {
  cardTypeCountsLabel,
  contentUpdatedAt,
  countLabel,
  subjectLabel,
  topicLabels,
  updatedLabel,
} from "@deephaus/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClozeText } from "@/components/cloze-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommunityDeckRelationBadge } from "@/components/ui/community-deck-relation-badge";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { NativeMenu } from "@/components/ui/native-menu";
import { NativeSheet } from "@/components/ui/native-sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { plainCardText } from "@/lib/card-preview";
import { API_BASE_URL } from "@/lib/config";
import { haptics } from "@/lib/haptics";
import { openDeck } from "@/lib/sections";
import { cardFontStyle, useCardFont } from "@/lib/study/card-font";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Samples shown before "Show more", and how many each press adds. */
const SAMPLES_FIRST = 3;
const SAMPLES_STEP = 5;
/** How many cards "Try cards" steps through. */
const TRY_COUNT = 10;

function cardFront(card: CommunityDeckCard): string {
  if (card.type === "cloze") return card.cloze_text ?? "";
  if (card.type === "image-occlusion") return plainCardText(card.extra) || "Image card";
  return card.front ?? "";
}

function cardBack(card: CommunityDeckCard): string {
  if (card.type === "basic") return plainCardText(card.back ?? card.extra);
  if (card.type === "cloze") return plainCardText(card.extra);
  return "";
}

export default function CommunityDeckScreen() {
  const { publicationId } = useLocalSearchParams<{ publicationId: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const cardFont = cardFontStyle(useCardFont());
  const [detail, setDetail] = useState<CommunityDeckDetail | null>(null);
  const [extra, setExtra] = useState<CommunityDeckCard[]>([]);
  const [shown, setShown] = useState(SAMPLES_FIRST);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);

  const load = useCallback(async () => {
    if (!publicationId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getCommunityDeck(publicationId));
      setExtra([]);
      setShown(SAMPLES_FIRST);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this deck.");
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const deck = detail?.publication ?? null;
  const loaded = useMemo(() => [...(detail?.previewCards ?? []), ...extra], [detail, extra]);
  const added = Boolean(detail?.is_subscribed);
  const owner = Boolean(deck?.is_owner);
  const syncMode = detail?.subscription_sync_mode ?? null;
  const localDeckId = detail?.local_project_id ?? deck?.local_project_id ?? null;
  const tryCount = Math.min(TRY_COUNT, deck?.card_count ?? 0);
  const topics = useMemo(() => topicLabels(detail?.facts?.tags ?? []), [detail]);
  const mix = detail?.facts ? cardTypeCountsLabel(detail.facts.types) : "";

  function patch(next: Partial<CommunityDeckDetail>, publication: Partial<CommunityDeckDetail["publication"]> = {}) {
    setDetail((current) =>
      current
        ? { ...current, ...next, publication: { ...current.publication, ...publication } }
        : current,
    );
  }

  /** Make sure at least `count` cards are loaded; false when they could not be fetched. */
  async function ensureLoaded(count: number): Promise<boolean> {
    if (!deck) return false;
    const want = Math.min(count, deck.card_count);
    if (loaded.length >= want) return true;
    setLoadingMore(true);
    try {
      const more = await api.getCommunityDeck(deck.id, {
        offset: loaded.length,
        limit: Math.max(SAMPLES_STEP, want - loaded.length),
      });
      setExtra((prev) => [...prev, ...more.previewCards]);
      return true;
    } catch (reason) {
      Alert.alert(
        "Could not load more cards",
        reason instanceof Error ? reason.message : "Unknown error",
      );
      return false;
    } finally {
      setLoadingMore(false);
    }
  }

  async function showMore() {
    const next = shown + SAMPLES_STEP;
    if (await ensureLoaded(next)) setShown(next);
  }

  async function tryCards() {
    if (await ensureLoaded(tryCount)) setTrying(true);
  }

  // Adding stays on this page: the deck is yours to open or study when you choose.
  async function add(mode: SyncMode) {
    if (!deck || busy) return;
    setBusy(true);
    try {
      const { localProjectId } = await api.subscribeCommunityDeck(deck.id, mode);
      haptics.success();
      patch(
        { is_subscribed: true, subscription_sync_mode: mode, local_project_id: localProjectId },
        {
          is_subscribed: true,
          subscription_sync_mode: mode,
          local_project_id: localProjectId,
          subscriber_count: deck.subscriber_count + 1,
        },
      );
    } catch (reason) {
      Alert.alert("Could not add this deck", reason instanceof Error ? reason.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function confirmStopFollowing() {
    if (!deck || busy) return;
    Alert.alert(
      "Stop following updates?",
      `“${deck.title}” stays in your decks with your progress, as a personal copy. It no longer changes when the author updates it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop following",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void api
              .stopFollowingCommunityDeck(deck.id)
              .then(() => patch({ subscription_sync_mode: "fork" }, { subscription_sync_mode: "fork" }))
              .catch((reason: unknown) =>
                Alert.alert(
                  "Could not update this deck",
                  reason instanceof Error ? reason.message : "Unknown error",
                ),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  async function rate(stars: number | null) {
    if (!deck || ratingBusy) return;
    setRatingBusy(true);
    try {
      const next =
        stars == null
          ? await api.clearCommunityDeckRating(deck.id)
          : await api.rateCommunityDeck(deck.id, stars);
      haptics.selection();
      patch(
        { my_rating: next.my_rating },
        { my_rating: next.my_rating, avg_rating: next.avg_rating, rating_count: next.rating_count },
      );
    } catch (reason) {
      Alert.alert("Rating failed", reason instanceof Error ? reason.message : "Unknown error");
    } finally {
      setRatingBusy(false);
    }
  }

  function share() {
    if (!deck) return;
    const url = `${API_BASE_URL}/community?deck=${deck.id}`;
    void Share.share(
      Platform.OS === "ios" ? { url, message: deck.title } : { message: `${deck.title}\n${url}` },
    ).catch(() => undefined);
  }

  const rated = (deck?.rating_count ?? 0) > 0;
  const subject = subjectLabel(deck?.subject);

  return (
    <View style={styles.root}>
      <ScreenHeader
        // The deck's title sits in the page on iOS, as on the deck page.
        title={Platform.OS === "ios" ? "" : (deck?.title ?? "Community deck")}
        backFallback="/community"
        actions={
          deck
            ? [{ icon: "share", sfIcon: "square.and.arrow.up", label: "Share this deck", onPress: share }]
            : []
        }
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !detail || !deck ? (
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="gray" size="lg" />
          <UIText variant="muted" style={styles.errorText}>
            {error ?? "Deck not found."}
          </UIText>
          <Button variant="secondary" label="Try again" onPress={() => void load()} />
        </View>
      ) : (
        <>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.content}
          >
            <View style={styles.intro}>
              {subject || owner || added ? (
                <View style={styles.tags}>
                  {subject ? <UIText variant="muted">{subject}</UIText> : null}
                  {owner || added ? (
                    <CommunityDeckRelationBadge deck={{ is_owner: owner, is_subscribed: added }} />
                  ) : null}
                </View>
              ) : null}
              <UIText style={styles.title}>{deck.title}</UIText>
              {deck.description?.trim() ? (
                <UIText variant="body" style={styles.description}>
                  {deck.description.trim()}
                </UIText>
              ) : null}
              <View style={styles.byline}>
                {deck.author ? (
                  <>
                    <View style={styles.avatar}>
                      <UIText style={styles.avatarText}>{deck.author.slice(0, 1).toUpperCase()}</UIText>
                    </View>
                    <UIText variant="muted" style={styles.author}>
                      @{deck.author}
                    </UIText>
                    <UIText variant="muted">·</UIText>
                  </>
                ) : null}
                <UIText variant="muted">{updatedLabel(contentUpdatedAt(deck))}</UIText>
              </View>
            </View>

            <View style={styles.stats}>
              <Stat value={deck.card_count.toLocaleString()} label={deck.card_count === 1 ? "card" : "cards"} />
              <Stat
                value={deck.subscriber_count.toLocaleString()}
                label={deck.subscriber_count === 1 ? "learner" : "learners"}
              />
              {rated ? (
                <Stat
                  value={(deck.avg_rating ?? 0).toFixed(1)}
                  label={countLabel(deck.rating_count ?? 0, "rating")}
                  star
                />
              ) : (
                <Stat value="New" label="No ratings yet" />
              )}
            </View>

            {mix || topics.length > 0 ? (
              <View style={styles.section}>
                <UIText variant="muted">Inside</UIText>
                {mix ? <UIText variant="body">{mix}</UIText> : null}
                {topics.length > 0 ? (
                  <View style={styles.topics}>
                    {topics.map((topic) => (
                      <View key={topic} style={styles.topic}>
                        <UIText variant="muted" numberOfLines={1}>
                          {topic}
                        </UIText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <UIText variant="muted">Sample cards</UIText>
                {loaded.length > 0 ? (
                  <Button
                    variant="tertiary"
                    size="sm"
                    label={tryCount === 1 ? "Try the card" : `Try ${tryCount} cards`}
                    disabled={loadingMore}
                    onPress={() => void tryCards()}
                    textStyle={styles.link}
                  />
                ) : null}
              </View>
              {loaded.length === 0 ? (
                <UIText variant="muted">No cards yet.</UIText>
              ) : (
                loaded.slice(0, shown).map((card) => {
                  const back = cardBack(card);
                  return (
                    <Card key={card.id} padding={14}>
                      <ClozeText text={cardFront(card)} mode="plain" textStyle={[cardFont, styles.sampleFront]} />
                      {back ? (
                        <>
                          <View style={styles.sampleDivider} />
                          <ClozeText text={back} mode="plain" textStyle={[cardFont, styles.sampleBack]} />
                        </>
                      ) : null}
                    </Card>
                  );
                })
              )}
              {shown < deck.card_count && loaded.length > 0 ? (
                <View style={styles.more}>
                  <UIText variant="muted">
                    {`Showing ${Math.min(shown, loaded.length).toLocaleString()} of ${deck.card_count.toLocaleString()}`}
                  </UIText>
                  <Button
                    variant="tertiary"
                    size="sm"
                    label="Show more"
                    loading={loadingMore}
                    disabled={loadingMore}
                    onPress={() => void showMore()}
                    textStyle={styles.link}
                  />
                </View>
              ) : null}
            </View>

            {added && !owner ? (
              <View style={[styles.section, styles.yours]}>
                <View style={styles.ratingRow}>
                  <UIText variant="muted">Your rating</UIText>
                  <StarRating
                    value={detail.my_rating ?? deck.my_rating ?? null}
                    disabled={ratingBusy}
                    onChange={(stars) => void rate(stars)}
                  />
                  {(detail.my_rating ?? deck.my_rating) != null ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      label="Clear"
                      accessibilityLabel="Clear rating"
                      disabled={ratingBusy}
                      textStyle={styles.link}
                      onPress={() => void rate(null)}
                    />
                  ) : null}
                </View>
                {syncMode === "follow" ? (
                  <View style={styles.followRow}>
                    <UIText variant="muted" style={styles.followText}>
                      You get the author's updates and keep your progress.
                    </UIText>
                    <Button
                      variant="tertiary"
                      size="sm"
                      label="Stop following"
                      accessibilityLabel="Stop following updates"
                      disabled={busy}
                      textStyle={styles.link}
                      onPress={confirmStopFollowing}
                    />
                  </View>
                ) : (
                  <UIText variant="muted">
                    A personal copy. It does not change when the author updates the deck.
                  </UIText>
                )}
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {owner ? (
              <>
                <UIText variant="muted" style={styles.barNote}>
                  Published by you
                </UIText>
                <Button
                  variant="primary"
                  size="lg"
                  label="Open deck"
                  onPress={() => openDeck(deck.source_project_id)}
                />
              </>
            ) : added ? (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  label="Open deck"
                  disabled={!localDeckId}
                  onPress={() => localDeckId && openDeck(localDeckId)}
                  style={styles.barButton}
                />
                <Button
                  variant="primary"
                  size="lg"
                  label="Study"
                  disabled={!localDeckId}
                  onPress={() => localDeckId && router.push(`/study/${localDeckId}`)}
                  style={styles.barButton}
                />
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  label="Add to my decks"
                  loading={busy}
                  disabled={busy}
                  onPress={() => void add("follow")}
                  style={styles.barButton}
                />
                <NativeMenu
                  label="Other ways to add this deck"
                  disabled={busy}
                  entries={[
                    {
                      label: "Add and follow updates",
                      sfIcon: "arrow.triangle.2.circlepath",
                      onPress: () => void add("follow"),
                    },
                    {
                      label: "Add as a personal copy",
                      sfIcon: "doc.on.doc",
                      onPress: () => void add("fork"),
                    },
                  ]}
                >
                  <View style={styles.menuButton}>
                    <Icon name="more" size={20} color={colors.fgPrimary} />
                  </View>
                </NativeMenu>
              </>
            )}
          </View>

          <TryCardsSheet
            cards={loaded.slice(0, tryCount)}
            visible={trying}
            onClose={() => setTrying(false)}
          />
        </>
      )}
    </View>
  );
}

function Stat({ value, label, star }: { value: string; label: string; star?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stat}>
      <View style={styles.statValue}>
        {star ? <Icon name="star" size={14} color={colors.dueDot} /> : null}
        <UIText style={styles.statNumber}>{value}</UIText>
      </View>
      <UIText variant="caption" numberOfLines={1}>
        {label}
      </UIText>
    </View>
  );
}

/** Step through a few cards the way a study session shows them: question, then answer. */
function TryCardsSheet({
  cards,
  visible,
  onClose,
}: {
  cards: CommunityDeckCard[];
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cardFont = cardFontStyle(useCardFont());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (visible) {
      setIndex(0);
      setRevealed(false);
    }
  }, [visible]);

  const card = cards[Math.min(index, cards.length - 1)];
  const last = index >= cards.length - 1;
  const back = card ? cardBack(card) : "";

  function go(next: number) {
    haptics.selection();
    setIndex(next);
    setRevealed(false);
  }

  return (
    <NativeSheet
      visible={visible}
      onClose={onClose}
      title={cards.length > 0 ? `${Math.min(index + 1, cards.length)} of ${cards.length}` : "Sample cards"}
      detents={["large"]}
    >
      {card ? (
        <View style={styles.tryBody}>
          <ScrollView style={styles.tryScroll} contentContainerStyle={styles.tryCard}>
            <ClozeText
              text={cardFront(card)}
              mode={card.type === "cloze" && !revealed ? "hidden" : "plain"}
              textStyle={[cardFont, styles.tryFront]}
            />
            {revealed && back ? (
              <>
                <View style={styles.sampleDivider} />
                <ClozeText text={back} mode="plain" textStyle={[cardFont, styles.tryBack]} />
              </>
            ) : null}
          </ScrollView>
          <View style={styles.tryActions}>
            <Button
              variant="secondary"
              size="lg"
              label="Back"
              disabled={index === 0}
              onPress={() => go(index - 1)}
              style={styles.barButton}
            />
            {!revealed && (back || card.type === "cloze") ? (
              <Button
                variant="primary"
                size="lg"
                label="Show answer"
                onPress={() => {
                  haptics.selection();
                  setRevealed(true);
                }}
                style={styles.barButton}
              />
            ) : last ? (
              <Button variant="primary" size="lg" label="Done" onPress={onClose} style={styles.barButton} />
            ) : (
              <Button
                variant="primary"
                size="lg"
                label="Next"
                onPress={() => go(index + 1)}
                style={styles.barButton}
              />
            )}
          </View>
        </View>
      ) : null}
    </NativeSheet>
  );
}

function StarRating({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled?: boolean;
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
            accessibilityState={{ selected: value === star, disabled }}
            hitSlop={4}
            disabled={disabled}
            onPress={() => onChange(star)}
          >
            <Icon
              name={filled ? "star" : "starOutline"}
              size={22}
              color={filled ? colors.dueDot : colors.fgQuaternary}
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
    content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 18 },
    intro: { gap: 8 },
    tags: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "700",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    description: { fontSize: 16, lineHeight: 23 },
    byline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
    avatar: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bgActive,
    },
    avatarText: { fontSize: 11, lineHeight: 14, fontWeight: "600", color: colors.fgSecondary },
    author: { color: colors.fgPrimary, fontWeight: "500" },
    stats: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.lineStrong,
    },
    stat: { flex: 1, minWidth: 0, gap: 1 },
    statValue: { flexDirection: "row", alignItems: "center", gap: 4 },
    statNumber: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      fontVariant: ["tabular-nums"],
    },
    section: { gap: 10 },
    sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    topics: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    topic: {
      maxWidth: "100%",
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.lineStrong,
    },
    link: { color: colors.accentInk },
    sampleFront: { fontSize: 15.5, lineHeight: 22, color: colors.fgPrimary },
    sampleBack: { fontSize: 15.5, lineHeight: 22, color: colors.fgSecondary },
    sampleDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.lineStrong, marginVertical: 10 },
    more: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    yours: {
      paddingTop: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.lineStrong,
    },
    ratingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    followRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    followText: { flex: 1 },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingTop: 12,
      paddingHorizontal: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.lineStrong,
      backgroundColor: colors.bgCanvas,
    },
    barNote: { flex: 1 },
    barButton: { flex: 1 },
    menuButton: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.bgHover,
    },
    tryBody: { flex: 1, paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
    tryScroll: { flex: 1 },
    tryCard: { paddingVertical: 20 },
    tryFront: { fontSize: 20, lineHeight: 29, color: colors.fgPrimary },
    tryBack: { fontSize: 18, lineHeight: 27, color: colors.fgSecondary },
    tryActions: { flexDirection: "row", gap: 10 },
  });
}
