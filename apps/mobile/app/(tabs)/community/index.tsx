import type { CommunityDeckDetail, CommunityDeckRow } from "@deephaus/api-client";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import { RichCardContent } from "@/components/rich-card-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MutedText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";

export default function CommunityScreen() {
  const [decks, setDecks] = useState<CommunityDeckRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CommunityDeckDetail | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

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
    try {
      const { localProjectId } = await api.subscribeCommunityDeck(preview.publication.id, syncMode);
      setPreviewOpen(false);
      Alert.alert("Subscribed", "Deck added to your library.");
      router.push(`/(tabs)/study/${localProjectId}`);
      await load();
    } catch (e) {
      Alert.alert("Subscribe failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function unsubscribe(publicationId: string) {
    await api.unsubscribeCommunityDeck(publicationId);
    await load();
  }

  return (
    <View style={styles.container}>
      <Input
        placeholder="Search community decks"
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => void load()}
      />

      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
          ListEmptyComponent={<MutedText style={styles.empty}>No community decks yet.</MutedText>}
          renderItem={({ item }) => (
            <Card style={styles.deckCard}>
              <Pressable onPress={() => void openPreview(item.id)}>
                <Text style={styles.title}>{item.title}</Text>
                {item.description ? <MutedText>{item.description}</MutedText> : null}
                <MutedText>
                  {item.card_count} cards · {item.subscriber_count} subscribers
                </MutedText>
              </Pressable>
              <View style={styles.actions}>
                {item.is_subscribed ? (
                  <Button label="Unsubscribe" variant="secondary" onPress={() => void unsubscribe(item.id)} />
                ) : (
                  <Button label="Preview" onPress={() => void openPreview(item.id)} />
                )}
              </View>
            </Card>
          )}
        />
      )}

      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{preview?.publication.title}</Text>
          {preview?.publication.description ? (
            <MutedText style={styles.modalDesc}>{preview.publication.description}</MutedText>
          ) : null}
          <FlatList
            data={preview?.previewCards ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
            renderItem={({ item }) => (
              <Card style={styles.previewCard}>
                <RichCardContent content={item.type === "basic" ? item.front : item.cloze_text} />
              </Card>
            )}
          />
          {!preview?.is_subscribed && (
            <View style={styles.modalActions}>
              <Button label="Follow (sync updates)" onPress={() => void subscribe("follow")} />
              <Button label="Fork (static copy)" variant="secondary" onPress={() => void subscribe("fork")} />
            </View>
          )}
          <Button label="Close" variant="secondary" onPress={() => setPreviewOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 16, gap: 8 },
  deckCard: { gap: 8 },
  title: { color: theme.colors.text, fontWeight: "700", fontSize: 16 },
  actions: { marginTop: 4 },
  empty: { textAlign: "center", marginTop: 24 },
  modal: { flex: 1, backgroundColor: theme.colors.background, padding: 16, gap: 8 },
  modalTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "700" },
  modalDesc: { marginBottom: 4 },
  previewCard: { gap: 6 },
  modalActions: { gap: 8 },
});
