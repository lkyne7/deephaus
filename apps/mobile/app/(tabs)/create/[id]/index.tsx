import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { CardMix, DetailLevel, GenerationSettings } from "@deephaus/shared";

type SourceTab = "text" | "doc" | "video";

const SOURCE_TABS: { id: SourceTab; icon: IconName; label: string }[] = [
  { id: "text", icon: "text", label: "Free text" },
  { id: "doc", icon: "document", label: "Document" },
  { id: "video", icon: "playOutline", label: "Video" },
];

const CARD_TYPES: { id: CardMix; icon: IconName; label: string }[] = [
  { id: "basic", icon: "bubbleSingle", label: "Front/Back" },
  { id: "cloze", icon: "textSnippet", label: "Fill-in" },
];

const DETAIL_LEVELS: { id: DetailLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export default function ProjectDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    getTaskForProject,
    startGenerationFromText,
    startGenerationFromFile,
    startGenerationFromYoutube,
  } = useBackgroundTasks();
  const [source, setSource] = useState<SourceTab>("text");
  const [text, setText] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const task = id ? getTaskForProject(id) : undefined;
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("medium");
  const [cardType, setCardType] = useState<CardMix>("basic");
  const [focusPrompt, setFocusPrompt] = useState("");
  const [publicationTitle, setPublicationTitle] = useState("");
  const [publicationDesc, setPublicationDesc] = useState("");
  const [published, setPublished] = useState(false);

  const settings: Partial<GenerationSettings> = {
    detailLevel,
    cardMix: cardType,
    focusPrompt: focusPrompt.trim() || undefined,
  };

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

  async function pickFile(type: "pdf" | "any") {
    if (!id) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: type === "pdf" ? "application/pdf" : "*/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    startGenerationFromFile(id, asset.uri, asset.name, type, settings);
  }

  function startGeneration() {
    if (!id) return;
    if (source === "text") {
      if (!text.trim()) return;
      startGenerationFromText(id, text, settings);
      return;
    }
    if (source === "video") {
      if (!youtubeUrl.trim()) return;
      startGenerationFromYoutube(id, youtubeUrl.trim(), settings);
      return;
    }
    void pickFile("pdf");
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

  const canGenerate =
    source === "text"
      ? text.trim().length > 0
      : source === "video"
        ? youtubeUrl.trim().length > 0
        : true;

  return (
    <View style={styles.root}>
      <PageHeader title="Create" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={16} style={{ gap: 14 }}>
          <Text style={styles.sectionTitle}>Source</Text>
          <Segmented<SourceTab>
            options={SOURCE_TABS}
            value={source}
            onChange={setSource}
          />

          {source === "text" && (
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Paste notes, transcripts, or any text</Text>
              <Field
                value={text}
                onChangeText={setText}
                placeholder="Paste your source material here..."
                multiline
                containerStyle={styles.textarea}
                inputStyle={{ textAlignVertical: "top", minHeight: 140 }}
              />
              <Text style={styles.helper}>{text.length} characters</Text>
            </View>
          )}

          {source === "doc" && (
            <Pressable
              onPress={() => void pickFile("pdf")}
              style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
            >
              <FeaturedIcon icon="upload" variant="gray" size="lg" />
              <Text style={styles.dropzoneTitle}>Tap to upload a PDF</Text>
              <Text style={styles.dropzoneSub}>Up to 200 pages</Text>
              <Button
                variant="tertiary"
                size="sm"
                label="Or pick any file"
                onPress={() => void pickFile("any")}
                style={{ marginTop: 6 }}
              />
            </Pressable>
          )}

          {source === "video" && (
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>YouTube URL</Text>
              <Field
                leadingIcon="youtube"
                value={youtubeUrl}
                onChangeText={setYoutubeUrl}
                placeholder="https://youtube.com/..."
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.helper}>We'll use the video's transcript.</Text>
            </View>
          )}
        </Card>

        <Card padding={16} style={{ gap: 16 }}>
          <Text style={styles.sectionTitle}>Card settings</Text>

          <View>
            <Text style={styles.fieldLabel}>Level of detail</Text>
            <Segmented<DetailLevel>
              options={DETAIL_LEVELS}
              value={detailLevel}
              onChange={setDetailLevel}
            />
          </View>

          <View>
            <Text style={styles.fieldLabel}>Card type</Text>
            <Segmented<CardMix>
              options={CARD_TYPES}
              value={cardType}
              onChange={setCardType}
            />
          </View>

          <View>
            <Text style={styles.fieldLabel}>Focus prompt (optional)</Text>
            <Field
              leadingIcon="focus"
              value={focusPrompt}
              onChangeText={setFocusPrompt}
              placeholder="e.g. exam prep, definitions only"
            />
          </View>
        </Card>

        {task && (
          <Card padding={14} style={{ gap: 10 }}>
            <View style={styles.jobHeader}>
              <FeaturedIcon icon="sparkles" variant="brand" size="sm" />
              <Text style={styles.jobStatus}>{taskPhaseLabel(task)}</Text>
            </View>
            <ProgressBar value={task.progress / 100} />
            <Text style={styles.backgroundHint}>You can switch tabs while this runs.</Text>
          </Card>
        )}

        <Button
          variant="brand"
          size="xl"
          pill
          label={task ? "Generating in background…" : "Generate cards"}
          leadingIcon="sparkles"
          disabled={Boolean(task) || !canGenerate}
          onPress={startGeneration}
          fullWidth
        />

        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Publish to community</Text>
          <Field
            leadingIcon="bookmark"
            value={publicationTitle}
            onChangeText={setPublicationTitle}
            placeholder="Publication title"
          />
          <Field
            value={publicationDesc}
            onChangeText={setPublicationDesc}
            placeholder="Short description for browsers"
            multiline
            containerStyle={styles.textarea}
            inputStyle={{ textAlignVertical: "top", minHeight: 80 }}
          />
          {published ? (
            <Button
              variant="danger"
              size="md"
              pill
              label="Unpublish"
              leadingIcon="close"
              onPress={() => void unpublishProject()}
              fullWidth
            />
          ) : (
            <Button
              variant="secondary"
              size="md"
              pill
              label="Publish"
              leadingIcon="share"
              onPress={() => void publishProject()}
              fullWidth
            />
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; icon?: IconName; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors, shadows } = useTheme();
  const segStyles = useMemo(() => createSegStyles(colors, shadows), [colors, shadows]);
  return (
    <View style={segStyles.row}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            style={[
              segStyles.cell,
              active && segStyles.cellActive,
            ]}
          >
            {opt.icon && (
              <Icon
                name={opt.icon}
                size={14}
                color={active ? colors.fgPrimary : colors.fgTertiary}
              />
            )}
            <Text style={[segStyles.label, active && segStyles.labelActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createSegStyles(
  colors: ThemeColors,
  shadows: ReturnType<typeof useTheme>["shadows"],
) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: colors.gray100,
      borderRadius: radius.pill,
      padding: 4,
      gap: 4,
    },
    cell: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
    },
    cellActive: {
      backgroundColor: colors.bgSurface,
      ...shadows.xs,
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgTertiary,
    },
    labelActive: {
      color: colors.fgPrimary,
    },
  });
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.1,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginBottom: 6,
    },
    helper: {
      fontSize: 12,
      color: colors.fgQuaternary,
      fontWeight: "500",
      marginTop: 4,
    },
    textarea: {
      alignItems: "flex-start",
      minHeight: 80,
    },
    dropzone: {
      padding: 28,
      borderColor: colors.gray200,
      borderWidth: 2,
      borderStyle: "dashed",
      borderRadius: radius.xl2,
      backgroundColor: colors.gray50,
      alignItems: "center",
      gap: 6,
    },
    dropzoneTitle: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginTop: 8,
    },
    dropzoneSub: {
      fontSize: 12,
      color: colors.fgQuaternary,
    },
    jobHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    jobStatus: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
      flex: 1,
    },
    backgroundHint: {
      fontSize: 12,
      color: colors.fgQuaternary,
    },
  });
}
