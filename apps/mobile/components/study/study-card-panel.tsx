import type { ReviewCardPayload } from "@deephaus/api-client";
import { cardTypeLabel, type ImageOcclusionData } from "@deephaus/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CardEditorFields,
  type CardEditorDraft,
} from "@/components/card-editor/card-editor-fields";
import { CardSaveStatus } from "@/components/card-editor/card-save-status";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { RichCardContent } from "@/components/rich-card-content";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { api } from "@/lib/api";
import { buildCardUpdateBody, cardUpdateSnapshot } from "@/lib/card-text-editing";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type StudyCardFields = Pick<
  ReviewCardPayload,
  "id" | "type" | "front" | "back" | "cloze_text" | "extra" | "occlusion_data"
>;

type Props = {
  mode: "edit" | "explain";
  card: StudyCardFields;
  visible: boolean;
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

export function StudyCardPanel({ mode, card, visible, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [draft, setDraft] = useState<CardEditorDraft>(() => toDraft(card));
  const [occlusionData, setOcclusionData] = useState<ImageOcclusionData | null>(
    () => (card.occlusion_data as ImageOcclusionData | null) ?? null,
  );
  const [occlusionFront, setOcclusionFront] = useState<string | null>(card.front);
  const [occlusionBack, setOcclusionBack] = useState<string | null>(card.back);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const cardType = draft.type;

  useEffect(() => {
    setDraft(toDraft(card));
    setOcclusionData((card.occlusion_data as ImageOcclusionData | null) ?? null);
    setOcclusionFront(card.front);
    setOcclusionBack(card.back);
    setExplanation(null);
    setExplainError(null);
  }, [card]);

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

  const persistEdits = useCallback(async () => {
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
    const saved = await api.updateCard(card.id, body as never);
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

  const { status: saveStatus, error: saveError } = useAutoSaveCard({
    cardId: mode === "edit" && visible ? card.id : null,
    snapshot: saveSnapshot,
    enabled: mode === "edit" && visible,
    save: persistEdits,
  });

  useEffect(() => {
    if (!visible || mode !== "explain") return;

    let cancelled = false;
    setExplainLoading(true);
    setExplainError(null);
    setExplanation(null);

    void (async () => {
      try {
        const data = await api.explainCard(card.id);
        if (!cancelled) setExplanation(data.explanation);
      } catch (err) {
        if (!cancelled) {
          setExplainError(err instanceof Error ? err.message : "Failed to load explanation");
        }
      } finally {
        if (!cancelled) setExplainLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, mode, card.id]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{mode === "edit" ? "Edit card" : "AI explainer"}</Text>
              {mode === "edit" ? <CardSaveStatus status={saveStatus} error={saveError} /> : null}
            </View>
            <Text style={styles.subtitle}>
              {mode === "edit"
                ? "Changes save automatically."
                : "A deeper look at this card's concept."}
            </Text>
            {mode === "edit" ? (
              <BadgePill
                tone="gray"
                label={cardTypeLabel(cardType, "short")}
                style={{ marginTop: 2 }}
              />
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Icon name="close" size={22} color={colors.fgSecondary} />
          </Pressable>
        </View>

        {mode === "edit" ? (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {explainLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.brand500} />
                <Text style={styles.loadingText}>Generating explanation…</Text>
              </View>
            ) : null}
            {explainError ? <Text style={styles.errorText}>{explainError}</Text> : null}
            {explanation && !explainLoading ? (
              <RichCardContent content={explanation} />
            ) : null}
            <Button variant="tertiary" size="lg" pill label="Close" onPress={onClose} fullWidth />
          </ScrollView>
        )}
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
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
      backgroundColor: colors.bgSurface,
    },
    headerText: {
      flex: 1,
      gap: 4,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 10,
    },
    title: {
      fontSize: 18,
      lineHeight: 24,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    closeBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.lg,
    },
    body: {
      padding: 20,
      gap: 16,
      paddingBottom: 40,
    },
    errorText: {
      fontSize: 13,
      color: colors.gradeAgain,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 24,
    },
    loadingText: {
      fontSize: 14,
      color: colors.fgTertiary,
    },
  });
}
