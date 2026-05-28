import type { CommunityDeckDetail, CommunityDeckRow } from "@deephaus/api-client";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ClozeText } from "@/components/cloze-text";
import { api } from "@/lib/api";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export default function CommunityScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [decks, setDecks] = useState<CommunityDeckRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CommunityDeckDetail | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDecks((await api.listCommunityDecks(search || undefined)).decks);
    } catch {
      setDecks([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPreview(id: string) {
    try {
      const data = await api.getCommunityDeck(id);
      setPreview(data);
      setPreviewOpen(true);
    } catch (e) {
      Alert.alert("Preview failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function subscribe(syncMode: "follow" | "fork") {
    if (!preview) return;
    setBusy(true);
    try {
      const { localProjectId } = await api.subscribeCommunityDeck(
        preview.publication.id,
        syncMode,
      );
      setPreviewOpen(false);
      router.push(`/(tabs)/study/${localProjectId}`);
      await load();
    } catch (e) {
      Alert.alert("Subscribe failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe(publicationId: string) {
    await api.unsubscribeCommunityDeck(publicationId);
    await load();
  }

  return (
    <View style={styles.root}>
      <PageHeader title="Community" />

      <View style={styles.searchRow}>
        <Field
          leadingIcon="search"
          placeholder="Search decks"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand500} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="community" variant="brand" size="lg" />
              <Text style={styles.emptyTitle}>No community decks yet</Text>
              <Text style={styles.emptyBody}>
                Be the first to publish a deck for others to study.
              </Text>
            </Card>
          }
          renderItem={({ item }) => (
            <Card padding={16}>
              <View style={styles.titleRow}>
                <Icon name="book" size={20} color={colors.fgSecondary} />
                <Text style={styles.title}>{item.title}</Text>
              </View>
              {item.description ? (
                <Text style={styles.desc}>{item.description}</Text>
              ) : null}
              <View style={styles.badges}>
                <BadgePill icon="layers" label={`${item.card_count} cards`} tone="brand" />
                <BadgePill icon="user" label={`${item.subscriber_count} subs`} tone="orange" />
              </View>
              <View style={styles.actions}>
                {item.is_subscribed ? (
                  <Button
                    variant="secondary"
                    size="md"
                    pill
                    label="Unsubscribe"
                    onPress={() => void unsubscribe(item.id)}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="md"
                      pill
                      label="Preview"
                      onPress={() => void openPreview(item.id)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="brand"
                      size="md"
                      pill
                      label="Subscribe"
                      leadingIcon="add"
                      onPress={() => void openPreview(item.id)}
                      style={{ flex: 1 }}
                    />
                  </>
                )}
              </View>
            </Card>
          )}
        />
      )}

      <PreviewModal
        visible={previewOpen}
        preview={preview}
        busy={busy}
        onClose={() => setPreviewOpen(false)}
        onSubscribe={subscribe}
      />
    </View>
  );
}

function PreviewModal({
  visible,
  preview,
  busy,
  onClose,
  onSubscribe,
}: {
  visible: boolean;
  preview: CommunityDeckDetail | null;
  busy: boolean;
  onClose: () => void;
  onSubscribe: (mode: "follow" | "fork") => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
        <PageHeader
          title="Deck preview"
          onBack={onClose}
          right={
            <Pressable onPress={onClose} hitSlop={6} style={styles.closePill}>
              <Icon name="close" size={18} color={colors.fgSecondary} />
            </Pressable>
          }
        />
        <FlatList
          ListHeaderComponent={
            preview ? (
              <View style={{ gap: 12 }}>
                <Card padding={16} style={{ gap: 8 }}>
                  <Text style={styles.previewTitle}>{preview.publication.title}</Text>
                  {preview.publication.description && (
                    <Text style={styles.previewDesc}>{preview.publication.description}</Text>
                  )}
                  <View style={styles.badges}>
                    <BadgePill
                      icon="layers"
                      label={`${preview.previewCards.length}+ cards`}
                      tone="brand"
                    />
                    {preview.publication.published_at && (
                      <BadgePill
                        icon="calendar"
                        label={new Date(preview.publication.published_at).toLocaleDateString()}
                        tone="gray"
                      />
                    )}
                  </View>
                </Card>
                <Text style={styles.previewSection}>Sample cards</Text>
              </View>
            ) : null
          }
          data={preview?.previewCards ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.previewList}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Card padding={14}>
              <ClozeText
                text={item.type === "basic" ? item.front ?? "" : item.cloze_text ?? ""}
                mode="plain"
                textStyle={{ fontSize: 14, lineHeight: 20, color: colors.fgPrimary }}
              />
            </Card>
          )}
        />
        {preview && !preview.is_subscribed && (
          <SafeAreaView edges={["bottom"]} style={styles.previewFooter}>
            <Button
              variant="brand"
              size="lg"
              pill
              label="Follow (sync updates)"
              leadingIcon="refresh"
              loading={busy}
              disabled={busy}
              onPress={() => onSubscribe("follow")}
              fullWidth
            />
            <Button
              variant="secondary"
              size="md"
              pill
              label="Fork (static copy)"
              loading={busy}
              disabled={busy}
              onPress={() => onSubscribe("fork")}
              fullWidth
            />
          </SafeAreaView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    searchRow: { paddingHorizontal: 16, paddingTop: 12 },
    list: {
      padding: 16,
      paddingTop: 16,
      paddingBottom: 32,
    },
    empty: { alignItems: "center", gap: 4, marginTop: 8 },
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
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    title: { fontSize: 16, fontWeight: "600", color: colors.fgPrimary, flex: 1 },
    desc: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary, marginBottom: 12 },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 14,
    },
    actions: { flexDirection: "row", gap: 8 },
    closePill: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.gray50,
    },
    previewTitle: {
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    previewDesc: { fontSize: 14, lineHeight: 20, color: colors.fgTertiary },
    previewSection: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgQuaternary,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      paddingHorizontal: 4,
    },
    previewList: { padding: 16, gap: 8 },
    previewFooter: {
      padding: 16,
      backgroundColor: colors.bgSurface,
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
      gap: 10,
    },
  });
}
