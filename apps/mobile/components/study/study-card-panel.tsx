import type { ReviewCardPayload } from "@deephaus/api-client";
import { cardTypeLabel, type ImageOcclusionData } from "@deephaus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CardEditorFields,
  type CardEditorDraft,
} from "@/components/card-editor/card-editor-fields";
import { CardSaveStatus } from "@/components/card-editor/card-save-status";
import { EditorKeyboardToolbar } from "@/components/card-editor/editor-keyboard-toolbar";
import { EditorToolbarProvider } from "@/components/card-editor/editor-toolbar-context";
import type { RichFieldCaret } from "@/components/card-editor/rich-field-types";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { BadgePill } from "@/components/ui/badge-pill";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { SheetHeader } from "@/components/ui/sheet-header";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { offlineData } from "@/lib/offline-data";
import { buildCardUpdateBody, cardUpdateSnapshot } from "@/lib/card-text-editing";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type StudyCardFields = Pick<
  ReviewCardPayload,
  "id" | "type" | "front" | "back" | "cloze_text" | "extra" | "occlusion_data"
>;

type Props = {
  card: StudyCardFields;
  onClose: () => void;
  onSaved: (updated: StudyCardFields) => void;
};

function toDraft(card: StudyCardFields): CardEditorDraft {
  return {
    type: card.type,
    front: card.front ?? "",
    back: card.back ?? card.extra ?? "",
    clozeText: card.cloze_text ?? "",
    extra: card.extra ?? "",
    tagsInput: "",
  };
}

/**
 * Edits the current card mid-session. This stays a page sheet: the rich fields
 * size themselves against it and open their own modals over it.
 */
export function StudyCardPanel({ card, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [draft, setDraft] = useState<CardEditorDraft>(() => toDraft(card));
  const [occlusionData, setOcclusionData] = useState<ImageOcclusionData | null>(
    () => (card.occlusion_data as ImageOcclusionData | null) ?? null,
  );
  const [occlusionFront, setOcclusionFront] = useState<string | null>(card.front);
  const [occlusionBack, setOcclusionBack] = useState<string | null>(card.back);

  const cardType = draft.type;

  const scrollRef = useRef<ScrollView>(null);
  const scrollFrameRef = useRef<View>(null);
  const scrollOffsetRef = useRef(0);

  // The editor web views can't scroll their host, so keep the caret in view
  // from here, as the full card editor does.
  const ensureCaretVisible = useCallback((node: View | null, caret: RichFieldCaret) => {
    const frame = scrollFrameRef.current;
    if (!node || !frame) return;
    node.measureInWindow((_x, fieldY) => {
      frame.measureInWindow((_frameX, frameY, _width, frameHeight) => {
        const caretTop = fieldY + caret.top;
        const caretBottom = fieldY + caret.bottom;
        const visibleTop = frameY + 8;
        const visibleBottom = frameY + frameHeight - 12;
        const offset = scrollOffsetRef.current;
        if (caretBottom > visibleBottom) {
          scrollRef.current?.scrollTo({ y: offset + (caretBottom - visibleBottom) + 32, animated: true });
        } else if (caretTop < visibleTop) {
          scrollRef.current?.scrollTo({ y: offset - (visibleTop - caretTop) - 24, animated: true });
        }
      });
    });
  }, []);

  useEffect(() => {
    setDraft(toDraft(card));
    setOcclusionData((card.occlusion_data as ImageOcclusionData | null) ?? null);
    setOcclusionFront(card.front);
    setOcclusionBack(card.back);
  }, [card.id]);

  const saveSnapshot = useMemo(
    () =>
      cardUpdateSnapshot({
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
      }),
    [draft, cardType, occlusionData, occlusionFront, occlusionBack],
  );

  const persistEdits = useCallback(async (isCurrent:()=>boolean=()=>true) => {
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
    });
    const saved = await offlineData.updateCard(card.id, body as never);
    if(!isCurrent()) return;
    onSaved({
      id: saved.id,
      type: saved.type,
      front: saved.front,
      back: saved.back,
      cloze_text: saved.cloze_text,
      extra: saved.extra,
      occlusion_data:
        cardType === "image-occlusion" ? occlusionData : saved.occlusion_data ?? null,
    });
  }, [card.id, draft, cardType, occlusionData, occlusionFront, occlusionBack, onSaved]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: card.id,
    snapshot: saveSnapshot,
    onRestore: (value) => {
      const restored = JSON.parse(value);
      setDraft((previous) => ({ ...previous!, type: restored.type, front: restored.front ?? "", back: restored.back ?? "", clozeText: restored.cloze_text ?? "", extra: restored.extra ?? "", tagsInput: (restored.tags ?? []).join(", ") }));
      setOcclusionData(restored.occlusion_data ?? null); setOcclusionFront(restored.front); setOcclusionBack(restored.back);
    },
    save: persistEdits,
  });

  const closePanel = useCallback(async () => {
    try {
      await flush();
    } catch {
      return;
    }
    onClose();
  }, [flush, onClose]);

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => void closePanel()}
    >
      <View style={[styles.root, { paddingTop: Platform.OS === "ios" ? 0 : insets.top }]}>
        <SheetHeader title="Edit card" onClose={() => void closePanel()} />
        <View style={styles.meta}>
          <BadgePill tone="gray" label={cardTypeLabel(cardType, "short")} />
          <Text style={styles.subtitle} numberOfLines={1}>
            Changes save automatically.
          </Text>
          <CardSaveStatus
            status={saveStatus}
            error={saveError}
            onRetry={() => {
              void flush().catch(() => undefined);
            }}
          />
        </View>

        <EditorToolbarProvider ensureCaretVisible={ensureCaretVisible}>
          <KeyboardScreen verticalOffset={insets.top + 8}>
            <View ref={scrollFrameRef} collapsable={false} style={{ flex: 1 }}>
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={styles.body}
                keyboardShouldPersistTaps="handled"
                onScroll={(event) => {
                  scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={32}
              >
                {cardType === "image-occlusion" ? (
                  <ImageOcclusionCardSection
                    cardId={card.id}
                    front={occlusionFront ?? ""}
                    back={occlusionBack ?? ""}
                    occlusionData={occlusionData}
                    onChange={(patch) => {
                      setOcclusionData(patch.occlusion_data);
                      setOcclusionFront(patch.front);
                      setOcclusionBack(patch.back);
                    }}
                  />
                ) : (
                  <CardEditorFields
                    cardId={card.id}
                    draft={draft}
                    onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                    showTags={false}
                  />
                )}
              </ScrollView>
            </View>
            <EditorKeyboardToolbar />
          </KeyboardScreen>
        </EditorToolbarProvider>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
    },
    meta: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomColor: colors.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    subtitle: {
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    body: {
      padding: 20,
      gap: 16,
      paddingBottom: 40,
    },
  });
}
