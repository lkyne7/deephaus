import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/lib/api";
import type { GenerationJob } from "@sluggo/shared";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState("");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [busy, setBusy] = useState(false);

  async function pollJob(jobId: string) {
    const interval = setInterval(async () => {
      const updated = await api.getJob(jobId);
      setJob(updated);
      if (updated.status === "ready") {
        clearInterval(interval);
        router.push(`/projects/${id}/review?job_id=${jobId}`);
      }
      if (updated.status === "failed") clearInterval(interval);
    }, 1500);
  }

  async function generateFromText() {
    if (!id) return;
    setBusy(true);
    try {
      const source = await api.addTextSource(id, text);
      const newJob = await api.startGeneration(source.id);
      setJob(newJob);
      void pollJob(newJob.id);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function pickPdf() {
    if (!id) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const source = await api.uploadPdfSource(id, blob, asset.name);
      const newJob = await api.startGeneration(source.id);
      setJob(newJob);
      void pollJob(newJob.id);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "PDF upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ gap: 12 }}>
      <Text style={styles.heading}>Add source</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        placeholder="Paste notes…"
        placeholderTextColor="#8b9cb3"
        multiline
        value={text}
        onChangeText={setText}
      />
      <Pressable style={styles.button} disabled={busy || !text.trim()} onPress={() => void generateFromText()}>
        <Text style={styles.buttonText}>Generate from text</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void pickPdf()}>
        <Text style={styles.secondaryText}>Pick PDF</Text>
      </Pressable>
      {busy && <ActivityIndicator color="#5b9fd4" />}
      {job && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status: {job.status}</Text>
          <Text style={styles.cardSub}>Progress: {job.progress}%</Text>
          {job.error && <Text style={styles.error}>{job.error}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1419", padding: 16 },
  heading: { fontSize: 22, fontWeight: "700", color: "#e8edf4" },
  input: {
    backgroundColor: "#1a2332",
    borderColor: "#2d3a4d",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: "#e8edf4",
  },
  textarea: { minHeight: 160, textAlignVertical: "top" },
  button: {
    backgroundColor: "#5b9fd4",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  buttonText: { color: "#0f1419", fontWeight: "700" },
  secondaryButton: {
    borderColor: "#2d3a4d",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#e8edf4" },
  card: {
    backgroundColor: "#1a2332",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2d3a4d",
  },
  cardTitle: { color: "#e8edf4", fontWeight: "600" },
  cardSub: { color: "#8b9cb3", marginTop: 4 },
  error: { color: "#f87171", marginTop: 8 },
});
