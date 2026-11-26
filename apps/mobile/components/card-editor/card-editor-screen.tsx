import type { ImageOcclusionData } from "@deephaus/shared";
import { router, useLocalSearchParams, useNavigation, usePathname, type Href } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CardEditorFields,
  type CardEditorDraft,
} from "@/components/card-editor/card-editor-fields";
import { CardDetailsSheet } from "@/components/card-editor/card-details-sheet";
import { CardMetaLine } from "@/components/card-editor/card-meta-line";
import { clozeAnswers } from "@/components/cloze-text";
import { EditorKeyboardToolbar } from "@/components/card-editor/editor-keyboard-toolbar";
import { EditorToolbarProvider } from "@/components/card-editor/editor-toolbar-context";
import type { RichFieldCaret } from "@/components/card-editor/rich-field-types";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
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
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { haptics } from "@/lib/haptics";
import type { BrowseCardRow } from "@deephaus/api-client";

function toDraft(card: BrowseCardRow): CardEditorDraft {
  return {
    type: card.type,
    front: card.front ?? "",
    back: card.back ?? card.extra ?? "",
    clozeText: card.cloze_text ?? "",
    // With no back, the extra stands in as the answer rather than showing twice.
    extra: card.type === "basic" && card.back == null ? "" : (card.extra ?? ""),
    tagsInput: card.tags.join(", "),
  };
}

/** True when a field holds no text and no media, ignoring empty markup. */
function isBlankField(value: string): boolean {
  if (/<img|\[sound:|\[image|\[audio/i.test(value)) return false;
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim() === "";
}

function isBlankDraft(draft: CardEditorDraft): boolean {
  return (
    isBlankField(draft.front) &&
    isBlankField(draft.back) &&
    isBlankField(draft.clozeText) &&
    isBlankField(draft.extra) &&
    draft.tagsInput.trim() === ""
  );
}

/** Card editor, opened from Browse or from a deck's Cards tab. `fallbackHref` is where it returns when there is no screen to pop. */
export function CardEditorScreen({ fallbackHref }: { fallbackHref: Href }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // `blank` marks a card made a moment ago by "Write a card by hand".
  const { cardId, blank } = useLocalSearchParams<{ cardId: string; blank?: string }>();
  const navigation = useNavigation();
  const pathname = usePathname();
  const headerInset = useHeaderInset();
  const leavingRef = useRef(false);
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isNew = blank === "1";
  const title = isNew ? "New card" : "Card";

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

  // Labels are drawn by dragging across the image, which iOS would otherwise
  // take for a swipe back. Swiping back from the edge still works.
  useEffect(() => {
    navigation.setOptions({ fullScreenGestureEnabled: cardType !== "image-occlusion" });
  }, [navigation, cardType]);

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

  // Leaving waits for unsaved edits, and drops a new card left blank so it
  // doesn't sit empty in the deck. usePreventRemove (unlike a bare
  // beforeRemove listener) also holds the native back button and swipe, so
  // the screen can't vanish natively while this runs.
  // Only hold the screen when there is something to wait for: holding it cancels
  // the swipe back, and the screen then leaves on its own once the work is done.
  // "idle" means nothing was edited, so the swipe finishes normally.
  const discardBlank = blank === "1" && draft != null && isBlankDraft(draft);
  const unsaved = saveStatus === "pending" || saveStatus === "saving" || saveStatus === "error";
  usePreventRemove(
    Boolean(card && draft) && (discardBlank || unsaved),
    ({ data }) => {
      if (!card || leavingRef.current) return;
      leavingRef.current = true;
      const leave = () => navigation.dispatch(data.action);
      if (discardBlank) {
        // Wait briefly so the deck doesn't list the card on return, but never
        // hold the user here for a slow network.
        void Promise.race([
          offlineData.deleteCard(card.id).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 800)),
        ]).then(leave);
        return;
      }
      void flush()
        .then(leave)
        .catch((error) => {
          leavingRef.current = false;
          Alert.alert(
            "Could not save changes",
            error instanceof Error ? error.message : "Try again before leaving this card.",
          );
        });
    },
  );

  // Making cards one after another: save this one and open a fresh card of the
  // same type in the same deck, in its place, so back still returns to the deck.
  // A fill-in card with no blanks makes no study cards, so it needs one first.
  const canMakeNext =
    isNew &&
    card != null &&
    draft != null &&
    cardType !== "image-occlusion" &&
    (cardType === "cloze" ? clozeAnswers(draft.clozeText).length > 0 : !isBlankDraft(draft));

  async function makeNextCard() {
    if (!card || !canMakeNext || busy) return;
    setBusy(true);
    try {
      await flush();
      const next = await offlineData.createCard({
        project_id: card.deck_id,
        type: cardType,
        append: false,
      });
      haptics.light();
      router.replace(`${pathname.replace(/[^/]+$/, next.id)}?blank=1` as Href);
    } catch (e) {
      Alert.alert("Could not start the next card", e instanceof Error ? e.message : "Unknown error");
      setBusy(false);
    }
  }

  async function toggleSuspend() {
    if (!card) return;
    setBusy(true);
    try {
      await flush();
      const suspended = !card.suspended;
      await offlineData.suspendCard(card.id, suspended);
      // Reloading would unmount the card, and the details sheet with it.
      setCard((current) => (current ? { ...current, suspended } : current));
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
        <ScreenHeader title={title} backFallback={fallbackHref} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
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

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={title}
        backFallback={fallbackHref}
        actions={[
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis",
            label: "Card actions",
            disabled: busy,
            items: [
              ...(isNew && cardType !== "image-occlusion"
                ? [
                    {
                      label: "Next card",
                      sfIcon: "plus" as const,
                      disabled: !canMakeNext,
                      onPress: () => void makeNextCard(),
                    },
                  ]
                : []),
              {
                label: "Card details",
                sfIcon: "info.circle",
                onPress: () => setDetailsOpen(true),
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
        <CardMetaLine
          type={cardType}
          deck={deckDisplayName(card.deck_name)}
          status={saveStatus}
          error={saveError}
          onRetry={() => {
            void flush().catch(() => undefined);
          }}
          onPress={() => setDetailsOpen(true)}
        />

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
      </ScrollView>
      </View>
      <EditorKeyboardToolbar
        trailingAction={
          isNew && cardType !== "image-occlusion"
            ? {
                label: "Next card",
                accessibilityHint:
                  cardType === "cloze" && !canMakeNext
                    ? "Make a blank first."
                    : "Saves this card and starts another in the same deck.",
                disabled: !canMakeNext || busy,
                onPress: () => void makeNextCard(),
              }
            : undefined
        }
      />
      </KeyboardScreen>
      </EditorToolbarProvider>
      <CardDetailsSheet
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        type={cardType}
        deck={deckDisplayName(card.deck_name)}
        tagsInput={draft.tagsInput}
        onTagsChange={(tagsInput) =>
          setDraft((current) => (current ? { ...current, tagsInput } : current))
        }
        suspended={card.suspended}
        onToggleSuspend={() => void toggleSuspend()}
        onDelete={() => void deleteCard()}
        disabled={busy}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 32, gap: 4 },
    notFound: { color: colors.fgTertiary },
  });
}
