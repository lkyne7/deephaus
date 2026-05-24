import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/lib/api";
import type { Project } from "@sluggo/shared";

export default function ProjectsScreen() {
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
    await api.createProject({ name, deck_name: deckName });
    setName("");
    setDeckName("");
    await load();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Projects</Text>
      <TextInput
        style={styles.input}
        placeholder="Project name"
        placeholderTextColor="#8b9cb3"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="Deck name"
        placeholderTextColor="#8b9cb3"
        value={deckName}
        onChangeText={setDeckName}
      />
      <Pressable style={styles.button} onPress={() => void createProject()}>
        <Text style={styles.buttonText}>Create project</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color="#5b9fd4" />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingTop: 16 }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/projects/${item.id}`)}
            >
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>Deck: {item.deck_name}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No projects yet.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#0f1419" },
  heading: { fontSize: 24, fontWeight: "700", color: "#e8edf4", marginBottom: 12 },
  input: {
    backgroundColor: "#1a2332",
    borderColor: "#2d3a4d",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: "#e8edf4",
    marginBottom: 8,
  },
  button: {
    backgroundColor: "#5b9fd4",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  buttonText: { color: "#0f1419", fontWeight: "700" },
  card: {
    backgroundColor: "#1a2332",
    borderColor: "#2d3a4d",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  cardTitle: { color: "#e8edf4", fontWeight: "600", fontSize: 16 },
  cardSub: { color: "#8b9cb3", marginTop: 4 },
  empty: { color: "#8b9cb3", textAlign: "center", marginTop: 24 },
});
