import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MutedText, ScreenTitle } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { Project } from "@deephaus/shared";

export default function CreateProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [deckName, setDeckName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject() {
    if (!name.trim() || !deckName.trim()) return;
    await api.createProject({ name: name.trim(), deck_name: deckName.trim() });
    setName("");
    setDeckName("");
    await load();
  }

  return (
    <View style={styles.container}>
      <ScreenTitle style={styles.heading}>Projects</ScreenTitle>
      <Input placeholder="Project name" value={name} onChangeText={setName} />
      <Input placeholder="Deck name" value={deckName} onChangeText={setDeckName} />
      <Button label="Create project" onPress={() => void createProject()} />

      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 16 }} />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingTop: 16 }}
          ListEmptyComponent={<MutedText style={styles.empty}>No projects yet.</MutedText>}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(tabs)/create/${item.id}`)}>
              <Card>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <MutedText>Deck: {item.deck_name}</MutedText>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.background, gap: 8 },
  heading: { marginBottom: 4 },
  cardTitle: { color: theme.colors.text, fontWeight: "600", fontSize: 16 },
  empty: { textAlign: "center", marginTop: 24 },
});
