import { cardTypeLabel } from "@deephaus/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { RichCardContent } from "@/components/rich-card-content";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { api } from "@/lib/api";
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

export default function BrowseCardDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const [card, setCard] = useState<BrowseCardRow | null>(null);
  const [draft, setDraft] = useState<CardEditorDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const found = await api.getCard(cardId);
      setCard(found);
      setDraft(toDraft(found));
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

  const saveSnapshot = useMemo(() => {
    if (!card || !draft) return "";
    return cardUpdateSnapshot({
      type: draft.type,
      front: draft.type === "basic" ? draft.front : null,
      back: draft.type === "basic" ? draft.back : null,
      cloze_text: draft.type === "cloze" ? draft.clozeText : null,
      extra: draft.extra || null,
      tags: parseTagsInput(draft.tagsInput),
    });
  }, [card, draft]);

  const persist = useCallback(async () => {
    if (!card || !draft) return;
    const body = buildCardUpdateBody({
      type: draft.type,
      front: draft.type === "basic" ? draft.front : null,
      back: draft.type === "basic" ? draft.back : null,
      cloze_text: draft.type === "cloze" ? draft.clozeText : null,
      extra: draft.extra || null,
      tags: parseTagsInput(draft.tagsInput),
    });
    const saved = await api.updateCard(card.id, body as never);
    setCard((current) =>
      current
        ? {
            ...current,
            front: saved.front,
            back: saved.back,
            cloze_text: saved.cloze_text,
            extra: saved.extra,
            tags: saved.tags ?? parseTagsInput(draft.tagsInput),
          }
        : current,
    );
  }, [card, draft]);

  const { status: saveStatus, error: saveError } = useAutoSaveCard({
    cardId: card?.id ?? null,
    snapshot: saveSnapshot,
    enabled: Boolean(card && draft),
    save: persist,
  });

  async function toggleSuspend() {
    if (!card) return;
    setBusy(true);
    try {
      await api.suspendCard(card.id, !card.suspended);
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
                await api.deleteCard(card.id);
                router.back();
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
        <PageHeader title="Card" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      </View>
    );
  }

  if (!card || !draft) {
    return (
      <View style={styles.root}>
        <PageHeader title="Card" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.notFound}>Card not found.</Text>
        </View>
      </View>
    );
  }

  const previewFront = draft.type === "basic" ? draft.front : draft.clozeText;
  const previewBack = draft.type === "basic" ? draft.back : null;

  return (
    <View style={styles.root}>
      <PageHeader title="Edit card" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card padding={16} style={{ gap: 12 }}>
          <View style={styles.deckRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.deckLabel}>{card.deck_name}</Text>
              <Text style={styles.cardType}>{cardTypeLabel(card.type)} card</Text>
            </View>
            <View style={styles.headerActions}>
              <CardSaveStatus status={saveStatus} error={saveError} />
              <Pressable
                onPress={() => void toggleSuspend()}
                disabled={busy}
                style={[
                  styles.suspendChip,
                  card.suspended ? styles.suspendChipActive : styles.suspendChipIdle,
                ]}
              >
                <Icon
                  name={card.suspended ? "pause" : "playOutline"}
                  size={14}
                  color={card.suspended ? colors.orange700 : colors.brand700}
                />
                <Text
                  style={[
                    styles.suspendText,
                    { color: card.suspended ? colors.orange700 : colors.brand700 },
                  ]}
                >
                  {card.suspended ? "Suspended" : "Active"}
                </Text>
              </Pressable>
            </View>
          </View>
          <RichCardContent content={previewFront} />
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
          <Text style={styles.sectionHint}>Changes save automatically.</Text>
          <CardEditorFields
            cardId={card.id}
            draft={draft}
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
            disabled={busy}
          />
        </View>

        <View style={styles.actions}>
          <Button
            variant="danger"
            size="md"
            pill
            label="Delete card"
            leadingIcon="warning"
            disabled={busy}
            onPress={() => void deleteCard()}
            fullWidth
          />
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { padding: 16, gap: 16, paddingBottom: 32 },
    notFound: { color: colors.fgTertiary },
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
      fontSize: 11,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.4,
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
      textTransform: "uppercase",
      letterSpacing: 0.6,
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
