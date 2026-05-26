import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CardContent } from "@/components/card-content";
import { api } from "@/lib/api";
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
      <Pressable style={styles.button} disabled={exporting || cards.length === 0} onPress={() => void exportDeck()}>
        <Text style={styles.buttonText}>{exporting ? "Exporting…" : "Share .apkg"}</Text>
      </Pressable>
      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.badge}>{item.type}</Text>
            {item.type === "basic" ? (
              <>
                <CardContent text={item.front} textStyle={styles.body} />
                <Text style={styles.arrow}>→</Text>
                <CardContent text={item.back} textStyle={styles.body} />
              </>
            ) : (
              <CardContent text={item.cloze_text} textStyle={styles.body} />
            )}
            {item.extra && <CardContent text={item.extra} textStyle={styles.extra} />}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No cards yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1419", padding: 16 },
  button: {
    backgroundColor: "#5b9fd4",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  buttonText: { color: "#0f1419", fontWeight: "700" },
  card: {
    backgroundColor: "#1a2332",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2d3a4d",
    gap: 8,
  },
  badge: { color: "#5b9fd4", fontWeight: "700", marginBottom: 2 },
  body: { color: "#e8edf4" },
  arrow: { color: "#8b9cb3", fontWeight: "700" },
  extra: { color: "#8b9cb3", fontSize: 12 },
  empty: { color: "#8b9cb3", textAlign: "center", marginTop: 24 },
});
