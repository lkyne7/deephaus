import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MutedText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { GenerationJob, GenerationSettings } from "@deephaus/shared";

const DETAIL_LEVELS = ["low", "medium", "high"] as const;
const CARD_MIXES = ["basic", "cloze"] as const;

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Partial<GenerationSettings>>({
    detailLevel: "medium",
    cardMix: "basic",
    newCardsPerDay: 10,
  });
  const [publicationTitle, setPublicationTitle] = useState("");
  const [publicationDesc, setPublicationDesc] = useState("");
  const [published, setPublished] = useState(false);

  useEffect(() => {
    if (!id) return;
    void api.getPublication(id).then((pub) => {
      setPublished(Boolean(pub));
      if (pub) {
        setPublicationTitle(pub.title);
        setPublicationDesc(pub.description ?? "");
      }
    });
  }, [id]);

  async function pollJob(jobId: string) {
    const interval = setInterval(async () => {
      const updated = await api.getJob(jobId);
      setJob(updated);
      if (updated.status === "ready") {
        clearInterval(interval);
        router.push(`/(tabs)/create/${id}/review?job_id=${jobId}`);
      }
      if (updated.status === "failed") clearInterval(interval);
    }, 1500);
  }

  async function generateFromText() {
    if (!id || !text.trim()) return;
    setBusy(true);
    try {
      const result = await api.generateFromText(id, text, settings);
      setJob(result.job);
      if (result.job.status === "ready") {
        router.push(`/(tabs)/create/${id}/review?job_id=${result.job.id}`);
      } else if (result.job.status === "failed") {
        Alert.alert("Error", result.job.error ?? "Generation failed");
      } else {
        void pollJob(result.job.id);
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(type: "pdf" | "any") {
    if (!id) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: type === "pdf" ? "application/pdf" : "*/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const source =
        type === "pdf"
          ? await api.uploadPdfSource(id, blob, asset.name)
          : await api.uploadFileSource(id, blob, asset.name);
      const { job: newJob } = await api.startGeneration(source.id, settings);
      setJob(newJob);
      void pollJob(newJob.id);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateFromYoutube() {
    if (!id || !youtubeUrl.trim()) return;
    setBusy(true);
    try {
      const source = await api.addYoutubeSource(id, youtubeUrl.trim());
      const { job: newJob } = await api.startGeneration(source.id, settings);
      setJob(newJob);
      void pollJob(newJob.id);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "YouTube import failed");
    } finally {
      setBusy(false);
    }
  }

  async function publishProject() {
    if (!id) return;
    try {
      await api.publishDeck({
        project_id: id,
        title: publicationTitle.trim() || undefined,
        description: publicationDesc.trim() || null,
      });
      setPublished(true);
      Alert.alert("Published", "Deck is now on the community.");
    } catch (e) {
      Alert.alert("Publish failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function unpublishProject() {
    if (!id) return;
    await api.unpublishDeck(id);
    setPublished(false);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Generation settings</Text>
      <View style={styles.row}>
        {DETAIL_LEVELS.map((level) => (
          <Button
            key={level}
            label={level}
            variant={settings.detailLevel === level ? "primary" : "secondary"}
            style={styles.chipBtn}
            onPress={() => setSettings((s) => ({ ...s, detailLevel: level }))}
          />
        ))}
      </View>
      <View style={styles.row}>
        {CARD_MIXES.map((mix) => (
          <Button
            key={mix}
            label={mix}
            variant={settings.cardMix === mix ? "primary" : "secondary"}
            style={styles.chipBtn}
            onPress={() => setSettings((s) => ({ ...s, cardMix: mix }))}
          />
        ))}
      </View>

      <Text style={styles.heading}>Add source</Text>
      <Input
        placeholder="Paste notes…"
        multiline
        style={styles.textarea}
        value={text}
        onChangeText={setText}
      />
      <Button
        label="Generate from text"
        disabled={busy || !text.trim()}
        onPress={() => void generateFromText()}
      />

      <Input
        placeholder="YouTube URL"
        autoCapitalize="none"
        value={youtubeUrl}
        onChangeText={setYoutubeUrl}
      />
      <Button
        label="Import YouTube"
        variant="secondary"
        disabled={busy || !youtubeUrl.trim()}
        onPress={() => void generateFromYoutube()}
      />

      <Button label="Pick PDF" variant="secondary" disabled={busy} onPress={() => void pickFile("pdf")} />
      <Button label="Pick file (doc/video)" variant="secondary" disabled={busy} onPress={() => void pickFile("any")} />

      {busy && <ActivityIndicator color={theme.colors.accent} />}
      {job && (
        <Card style={styles.jobCard}>
          <Text style={styles.jobTitle}>Status: {job.status}</Text>
          <MutedText>Progress: {job.progress}%</MutedText>
          {job.error && <Text style={styles.error}>{job.error}</Text>}
        </Card>
      )}

      <Text style={styles.heading}>Community</Text>
      <Input placeholder="Publication title" value={publicationTitle} onChangeText={setPublicationTitle} />
      <Input
        placeholder="Description"
        multiline
        style={styles.textarea}
        value={publicationDesc}
        onChangeText={setPublicationDesc}
      />
      {published ? (
        <Button label="Unpublish from community" variant="danger" onPress={() => void unpublishProject()} />
      ) : (
        <Button label="Publish to community" variant="secondary" onPress={() => void publishProject()} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, gap: 10 },
  heading: { fontSize: 18, fontWeight: "700", color: theme.colors.text, marginTop: 4 },
  textarea: { minHeight: 140, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipBtn: { flexGrow: 1, minWidth: 90 },
  jobCard: { gap: 4 },
  jobTitle: { color: theme.colors.text, fontWeight: "600" },
  error: { color: theme.colors.error, marginTop: 4 },
});
