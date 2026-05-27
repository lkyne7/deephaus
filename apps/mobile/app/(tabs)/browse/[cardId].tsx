import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
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
import type { BrowseCardRow } from "@deephaus/api-client";

export default function BrowseCardDetailScreen() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const [card, setCard] = useState<BrowseCardRow | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [clozeText, setClozeText] = useState("");
  const [extra, setExtra] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const found = await api.getCard(cardId);
      setCard(found);
      setFront(found.front ?? "");
      setBack(found.back ?? "");
      setClozeText(found.cloze_text ?? "");
      setExtra(found.extra ?? "");
    } catch {
      setCard(null);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!card) return;
    setSaving(true);
    try {
      await api.updateCard(card.id, {
        front: card.type === "basic" ? front : null,
        back: card.type === "basic" ? back : null,
        cloze_text: card.type === "cloze" ? clozeText : null,
        extra: extra || null,
        tags: card.tags,
      });
      Alert.alert("Saved", "Card updated.");
      await load();
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuspend() {
    if (!card) return;
    await api.suspendCard(card.id, !card.suspended);
    await load();
  }

  async function uploadImage() {
    if (!card) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const filename = asset.fileName ?? "image.jpg";
    const { url } = await api.uploadCardMedia(card.id, blob, filename);
    const markdown = `![image](${url})`;
    if (card.type === "basic") setFront((v) => `${v}\n${markdown}`);
    else setClozeText((v) => `${v}\n${markdown}`);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (!card) {
    return (
      <View style={styles.center}>
        <MutedText>Card not found.</MutedText>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.preview}>
        <Text style={styles.meta}>{card.deck_name}</Text>
        <RichCardContent content={card.type === "basic" ? front : clozeText} />
        {card.type === "basic" && <RichCardContent content={back} />}
      </Card>

      {card.type === "basic" ? (
        <>
          <Input placeholder="Front" multiline style={styles.textarea} value={front} onChangeText={setFront} />
          <Input placeholder="Back" multiline style={styles.textarea} value={back} onChangeText={setBack} />
        </>
      ) : (
        <Input placeholder="Cloze text" multiline style={styles.textarea} value={clozeText} onChangeText={setClozeText} />
      )}
      <Input placeholder="Extra" multiline style={styles.textarea} value={extra} onChangeText={setExtra} />

      <Button label={saving ? "Saving…" : "Save changes"} disabled={saving} onPress={() => void save()} />
      <Button
        label={card.suspended ? "Unsuspend" : "Suspend"}
        variant="secondary"
        onPress={() => void toggleSuspend()}
      />
      <Button label="Add image" variant="secondary" onPress={() => void uploadImage()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.background },
  preview: { gap: 8 },
  meta: { color: theme.colors.muted, fontSize: 12 },
  textarea: { minHeight: 100, textAlignVertical: "top" },
});
