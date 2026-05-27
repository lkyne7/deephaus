import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Card } from "@/components/ui/card";
import { MutedText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { StudyDeckOption } from "@deephaus/api-client";

export default function StudyHubScreen() {
  const [decks, setDecks] = useState<StudyDeckOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { decks: items } = await api.listDecks();
      setDecks(items);
    } catch {
      setDecks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={decks}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={theme.colors.accent}
        />
      }
      ListEmptyComponent={<MutedText style={styles.empty}>No decks ready to study.</MutedText>}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/(tabs)/study/${item.id}`)}>
          <Card style={styles.deckCard}>
            <Text style={styles.deckTitle}>{item.title}</Text>
            <MutedText>
              {item.due} due · {item.new} new · {item.waiting} waiting
            </MutedText>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, gap: 10 },
  center: { flex: 1, justifyContent: "center", backgroundColor: theme.colors.background },
  deckCard: { marginBottom: 10 },
  deckTitle: { color: theme.colors.text, fontWeight: "600", fontSize: 16 },
  empty: { textAlign: "center", marginTop: 24 },
});
