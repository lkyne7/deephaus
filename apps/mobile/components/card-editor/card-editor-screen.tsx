import { cardTypeLabel, type ImageOcclusionData } from "@deephaus/shared";
import { useLocalSearchParams, useNavigation, type Href } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
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
import { CardListItem } from "@/components/card-list-item";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { deckDisplayName } from "@/lib/deck-name";
import { useHeaderInset } from "@/lib/header-inset";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import { haptics } from "@/lib/haptics";
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
        <ScreenHeader title="Edit card" backFallback={fallbackHref} />
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

  // The card as every list shows it, updating as the fields change.
  const preview = {
    type: cardType,
    front: cardType === "basic" ? draft.front : card.front,
    back: cardType === "basic" ? draft.back : card.back,
    cloze_text: cardType === "cloze" ? draft.clozeText : null,
    extra: draft.extra || null,
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Edit card"
        backFallback={fallbackHref}
        actions={[
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis",
            label: "Card actions",
            disabled: busy,
            items: [
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
        {/* Where the card lives and what kind it is: labels, since neither changes here. */}
        <View style={styles.meta}>
          <Icon name="folder" size={15} color={colors.fgTertiary} />
          <Text style={styles.deck} numberOfLines={1}>
            {deckDisplayName(card.deck_name)}
          </Text>
          <CardSaveStatus status={saveStatus} error={saveError} onRetry={()=>{void flush().catch(()=>undefined);}} />
          <Text style={styles.type}>{cardTypeLabel(cardType, "short")}</Text>
        </View>

        <CardListItem card={preview} />

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

        <View style={styles.status}>
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>Active</Text>
            <Text style={styles.statusHint}>
              {card.suspended
                ? "Suspended: it won't come up in study until you turn this on."
                : "Comes up in study. Turn off to suspend it."}
            </Text>
          </View>
          <Switch
            value={!card.suspended}
            disabled={busy}
            onValueChange={() => {
              haptics.selection();
              void toggleSuspend();
            }}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Active"
          />
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
    content: { padding: 16, gap: 14, paddingBottom: 32 },
    notFound: { color: colors.fgTertiary },
    meta: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 },
    deck: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.fgSecondary },
    type: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: colors.fgTertiary,
      backgroundColor: colors.bgSunken,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
      overflow: "hidden",
    },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      paddingLeft: 14,
      paddingRight: 12,
      borderRadius: radius.xl2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    statusCopy: { flex: 1, gap: 1 },
    statusTitle: { fontSize: 15, lineHeight: 20, color: colors.fgPrimary },
    statusHint: { fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
  });
}
