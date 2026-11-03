import {
  cardTypeBadgeTone,
  cardTypeLabel,
  occlusionCardPreviewText,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { useLocalSearchParams, useNavigation, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CardEditorFields,
  type CardEditorDraft,
} from "@/components/card-editor/card-editor-fields";
import { CardSaveStatus } from "@/components/card-editor/card-save-status";
import { EditorKeyboardToolbar } from "@/components/card-editor/editor-keyboard-toolbar";
import { EditorToolbarProvider } from "@/components/card-editor/editor-toolbar-context";
import type { RichFieldCaret } from "@/components/card-editor/rich-field-types";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { RichCardContent } from "@/components/rich-card-content";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { deckDisplayName } from "@/lib/deck-name";
import { useHeaderInset } from "@/lib/header-inset";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import {
  buildCardUpdateBody,
  cardUpdateSnapshot,
  parseTagsInput,
} from "@/lib/card-text-editing";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { BrowseCardRow } from "@deephaus/api-client";

function toDraft(card: BrowseCardRow): CardEditorDraft {
  return {
    type: card.type,
    front: card.front ?? "",
    back: card.back ?? card.extra ?? "",
    clozeText: card.cloze_text ?? "",
    extra: card.extra ?? "",
    tagsInput: card.tags.join(", "),
  };
}

/** Card editor, opened from Browse or from a deck's Cards tab. `fallbackHref` is where it returns when there is no screen to pop. */
export function CardEditorScreen({ fallbackHref }: { fallbackHref: Href }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const allowNavigationRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollFrameRef = useRef<View>(null);
  const scrollOffsetRef = useRef(0);
  const [card, setCard] = useState<BrowseCardRow | null>(null);
  const [draft, setDraft] = useState<CardEditorDraft | null>(null);
  const [occlusionData, setOcclusionData] = useState<ImageOcclusionData | null>(null);
  const [occlusionFront, setOcclusionFront] = useState<string | null>(null);
  const [occlusionBack, setOcclusionBack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const found = await offlineData.getCard(cardId);
      setCard(found);
      setDraft(toDraft(found));
      if (found.type === "image-occlusion") {
        setOcclusionData((found.occlusion_data as ImageOcclusionData | null) ?? null);
        setOcclusionFront(found.front);
        setOcclusionBack(found.back);
      } else {
        setOcclusionData(null);
        setOcclusionFront(null);
        setOcclusionBack(null);
      }
    } catch {
      setCard(null);
      setDraft(null);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Web views don't ask the scroll view to reveal their caret; do it from the
  // caret box the editor reports, measured against the visible frame (which
  // the keyboard-avoiding wrapper has already shrunk).
  const ensureCaretVisible = useCallback(
    (node: View | null, caret: RichFieldCaret) => {
      const frame = scrollFrameRef.current;
      if (!node || !frame) return;
      node.measureInWindow((_x, fieldY) => {
        frame.measureInWindow((_frameX, frameY, _width, frameHeight) => {
          const caretTop = fieldY + caret.top;
          const caretBottom = fieldY + caret.bottom;
          const visibleTop = frameY + headerInset + 8;
          const visibleBottom = frameY + frameHeight - 12;
          const offset = scrollOffsetRef.current;
          if (caretBottom > visibleBottom) {
            scrollRef.current?.scrollTo({ y: offset + (caretBottom - visibleBottom) + 32, animated: true });
          } else if (caretTop < visibleTop) {
            scrollRef.current?.scrollTo({ y: offset - (visibleTop - caretTop) - 24, animated: true });
          }
        });
      });
    },
    [headerInset],
  );

  const cardType = draft?.type ?? card?.type ?? "basic";

  const saveSnapshot = useMemo(() => {
    if (!card || !draft) return "";
    return cardUpdateSnapshot({
      type: cardType,
      front:
        cardType === "basic"
          ? draft.front
          : cardType === "image-occlusion"
            ? occlusionFront
            : null,
      back:
        cardType === "basic"
          ? draft.back
          : cardType === "image-occlusion"
            ? occlusionBack
            : null,
      cloze_text: cardType === "cloze" ? draft.clozeText : null,
      extra: draft.extra || null,
      occlusion_data: cardType === "image-occlusion" ? occlusionData : null,
      tags: parseTagsInput(draft.tagsInput),
    });
  }, [card, draft, cardType, occlusionData, occlusionFront, occlusionBack]);

  const persist = useCallback(async (isCurrent:()=>boolean=()=>true) => {
    if (!card || !draft) return;
    const body = buildCardUpdateBody({
      type: cardType,
      front:
        cardType === "basic"
          ? draft.front
          : cardType === "image-occlusion"
            ? occlusionFront
            : null,
      back:
        cardType === "basic"
          ? draft.back
          : cardType === "image-occlusion"
            ? occlusionBack
            : null,
      cloze_text: cardType === "cloze" ? draft.clozeText : null,
      extra: draft.extra || null,
      occlusion_data: cardType === "image-occlusion" ? occlusionData : null,
      tags: parseTagsInput(draft.tagsInput),
    });
    const saved = await offlineData.updateCard(card.id, body);
    if(!isCurrent()) return;
    setCard((current) =>
      current
        ? {
            ...current,
            type: saved.type,
            front: saved.front,
            back: saved.back,
            cloze_text: saved.cloze_text,
            extra: saved.extra,
            occlusion_data:
              cardType === "image-occlusion" ? occlusionData : current.occlusion_data,
            tags: saved.tags ?? parseTagsInput(draft.tagsInput),
          }
        : current,
    );
  }, [card, draft, cardType, occlusionData, occlusionFront, occlusionBack]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: card?.id ?? null,
    snapshot: saveSnapshot,
    enabled: Boolean(card && draft),
    onRestore: (value) => {
      const restored = JSON.parse(value);
      setDraft((previous) => ({ ...previous!, type: restored.type, front: restored.front ?? "", back: restored.back ?? "", clozeText: restored.cloze_text ?? "", extra: restored.extra ?? "", tagsInput: (restored.tags ?? []).join(", ") }));
      setOcclusionData(restored.occlusion_data ?? null); setOcclusionFront(restored.front); setOcclusionBack(restored.back);
    },
    save: persist,
  });

  useEffect(() => {
    return navigation.addListener("beforeRemove", (event) => {
      if (allowNavigationRef.current || !card || !draft || saveStatus === "saved") return;
      event.preventDefault();
      void flush()
        .then(() => {
          allowNavigationRef.current = true;
          navigation.dispatch(event.data.action);
        })
        .catch((error) => {
          Alert.alert(
            "Could not save changes",
            error instanceof Error ? error.message : "Try again before leaving this card.",
          );
        });
    });
  }, [card, draft, flush, navigation, saveStatus]);

  async function toggleSuspend() {
    if (!card) return;
    setBusy(true);
    try {
      await flush();
      await offlineData.suspendCard(card.id, !card.suspended);
      await load();
    } catch (e) {
      Alert.alert("Update failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCard() {
    if (!card) return;
    Alert.alert(
      "Delete card",
      "This card will be permanently deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await flush();
                await offlineData.deleteCard(card.id);
                setCard(null);
                setDraft(null);
                goBackOrReplace(fallbackHref);
              } catch (e) {
                Alert.alert("Delete failed", e instanceof Error ? e.message : "Unknown error");
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Card" backFallback={fallbackHref} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      </View>
    );
  }

  if (!card || !draft) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Card" backFallback={fallbackHref} />
        <View style={styles.center}>
          <Text style={styles.notFound}>Card not found.</Text>
        </View>
      </View>
    );
  }

  const previewFront =
    cardType === "image-occlusion"
      ? occlusionCardPreviewText(card.front, card.back)
      : cardType === "basic"
        ? draft.front
        : draft.clozeText;
  const previewBack = cardType === "basic" ? draft.back : null;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Edit card"
        backFallback={fallbackHref}
        actions={[
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis.circle",
            label: "Card actions",
            disabled: busy,
            items: [
              {
                label: card.suspended ? "Unsuspend card" : "Suspend card",
                sfIcon: card.suspended ? "play.circle" : "pause.circle",
                onPress: () => void toggleSuspend(),
              },
              {
                label: "Delete card",
                sfIcon: "trash",
                destructive: true,
                onPress: () => void deleteCard(),
              },
            ],
          },
        ]}
      />
      <EditorToolbarProvider ensureCaretVisible={ensureCaretVisible}>
      <KeyboardScreen>
      <View ref={scrollFrameRef} collapsable={false} style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
      >
        <Card padding={16} style={{ gap: 12 }}>
          <View style={styles.deckRow}>
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <Text style={styles.deckLabel}>{deckDisplayName(card.deck_name)}</Text>
              <BadgePill tone={cardTypeBadgeTone(cardType)} label={cardTypeLabel(cardType, "short")} />
            </View>
            <CardSaveStatus status={saveStatus} error={saveError} onRetry={()=>{void flush().catch(()=>undefined);}} />
          </View>
          {cardType === "image-occlusion" ? (
            <Text style={styles.previewText}>{previewFront}</Text>
          ) : (
            <RichCardContent content={previewFront} />
          )}
          {previewBack ? (
            <>
              <View style={styles.divider} />
              <RichCardContent content={previewBack} />
            </>
          ) : null}
          {draft.type === "cloze" && draft.extra ? (
            <>
              <View style={styles.divider} />
              <RichCardContent content={draft.extra} />
            </>
          ) : null}
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Content</Text>
          <Text style={styles.sectionHint}>Changes save automatically. Tap a field to format it.</Text>
          {cardType === "image-occlusion" ? (
            <ImageOcclusionCardSection
              cardId={card.id}
              front={card.front ?? ""}
              back={card.back ?? ""}
              occlusionData={occlusionData}
              disabled={busy}
              onChange={(patch) => {
                setOcclusionData(patch.occlusion_data);
                setOcclusionFront(patch.front);
                setOcclusionBack(patch.back);
                setCard((current) =>
                  current
                    ? {
                        ...current,
                        type: "image-occlusion",
                        front: patch.front,
                        back: patch.back,
                        occlusion_data: patch.occlusion_data,
                      }
                    : current,
                );
              }}
            />
          ) : (
            <CardEditorFields
              cardId={card.id}
              draft={draft}
              onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
              disabled={busy}
            />
          )}
        </View>

      </ScrollView>
      </View>
      <EditorKeyboardToolbar />
      </KeyboardScreen>
      </EditorToolbarProvider>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { padding: 16, gap: 16, paddingBottom: 32 },
    notFound: { color: colors.fgTertiary },
    previewText: {
      fontSize: 16,
      lineHeight: 24,
      color: colors.fgPrimary,
    },
    deckRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    deckLabel: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    cardType: {
      fontSize: 12,
      color: colors.fgQuaternary,
      marginTop: 2,
    },
    headerActions: {
      alignItems: "flex-end",
      gap: 8,
    },
    suspendChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    suspendChipActive: {
      backgroundColor: colors.orange50,
      borderColor: colors.orange200,
    },
    suspendChipIdle: {
      backgroundColor: colors.brand50,
      borderColor: colors.brand200,
    },
    suspendText: {
      fontSize: 12,
      fontWeight: "500",
      letterSpacing: 0,
    },
    divider: {
      height: 1,
      backgroundColor: colors.borderSecondary,
    },
    section: {
      gap: 12,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: 0,
    },
    sectionHint: {
      fontSize: 13,
      color: colors.fgTertiary,
      marginTop: -4,
    },
    actions: {
      gap: 10,
      paddingTop: 4,
    },
  });
}
