import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RichCardContent } from "@/components/rich-card-content";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MutedText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { DraftCard } from "@deephaus/shared";

export default function ReviewScreen() {
  const { id, job_id } = useLocalSearchParams<{ id: string; job_id: string }>();
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!job_id) return;
    void api.listCards(job_id).then(setCards).catch(() => setCards([]));
  }, [job_id]);

  async function exportDeck() {
    if (!id || !job_id) return;
    setExporting(true);
    try {
      const blob = await api.exportDeck(id, job_id);
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const path = `${FileSystem.cacheDirectory}deephaus-deck.apkg`;
        await FileSystem.writeAsStringAsync(path, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, {
            mimeType: "application/octet-stream",
            dialogTitle: "Export Anki deck",
          });
        } else {
          Alert.alert("Exported", `Saved to ${path}`);
        }
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Button
        label={exporting ? "Exporting…" : "Share .apkg"}
        disabled={exporting || cards.length === 0}
        onPress={() => void exportDeck()}
      />
      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.badge}>{item.type}</Text>
            {item.type === "basic" ? (
              <>
                <RichCardContent content={item.front} />
                <Text style={styles.arrow}>→</Text>
                <RichCardContent content={item.back} />
              </>
            ) : (
              <RichCardContent content={item.cloze_text} />
            )}
            {item.extra && <RichCardContent content={item.extra} />}
          </Card>
        )}
        ListEmptyComponent={<MutedText style={styles.empty}>No cards yet.</MutedText>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 16 },
  card: { gap: 8 },
  badge: { color: theme.colors.accent, fontWeight: "700" },
  arrow: { color: theme.colors.muted, fontWeight: "700" },
  empty: { textAlign: "center", marginTop: 24 },
});
