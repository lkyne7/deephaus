import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { QuizletImportResponse } from "@deephaus/api-client";
import { MAX_APKG_BYTES } from "@deephaus/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
import { goBackOrReplace } from "@/lib/navigation";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type PickedFile = {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
};
type ImportMode = "anki" | "quizlet";

const MAX_GB = Math.round(MAX_APKG_BYTES / (1024 * 1024 * 1024));

export default function ImportDeckScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { tasks, startAnkiImport } = useBackgroundTasks();
  const [mode, setMode] = useState<ImportMode>("anki");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [keepScheduling, setKeepScheduling] = useState(true);
  const [combineName, setCombineName] = useState("");
  const [quizletText, setQuizletText] = useState("");
  const [quizletName, setQuizletName] = useState("");
  const [quizletImporting, setQuizletImporting] = useState(false);
  const [quizletResult, setQuizletResult] = useState<QuizletImportResponse | null>(null);

  const importTask = tasks.find((task) => task.kind === "anki-import");
  const result = mode === "anki" ? importTask?.ankiResult ?? null : quizletResult;
  const importing = mode === "anki" ? importTask?.status === "running" : quizletImporting;

  async function pickFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    if (mode === "anki" && !/\.(apkg|colpkg)$/i.test(asset.name)) {
      Alert.alert("Wrong file type", "Choose an Anki package (.apkg) file.");
      return;
    }
    if (mode === "quizlet" && !/\.(txt|tsv|csv)$/i.test(asset.name)) {
      Alert.alert("Wrong file type", "Choose a Quizlet text, TSV, or CSV export.");
      return;
    }
    if (mode === "quizlet") {
      if ((asset.size ?? 0) > 5 * 1024 * 1024) {
        Alert.alert("File too large", "Quizlet exports must be 5 MB or smaller.");
        return;
      }
      try {
        const response = await fetch(asset.uri);
        setQuizletText(await response.text());
        setQuizletName((current) => current || asset.name.replace(/\.(txt|tsv|csv)$/i, ""));
        setQuizletResult(null);
      } catch {
        Alert.alert("Could not read file", "Try exporting the Quizlet set again.");
      }
    }
    setFile({
      uri: asset.uri,
      name: asset.name,
      size: asset.size ?? null,
      mimeType: asset.mimeType ?? null,
    });
  }

  async function runImport() {
    if (importing) return;
    if (mode === "anki") {
      if (!file) return;
      startAnkiImport(file.uri, file.name, {
        deckName: combineName.trim() || undefined,
        scheduling: keepScheduling,
        fileSize: file.size ?? undefined,
        mimeType: file.mimeType ?? undefined,
      });
      return;
    }
    if (!quizletText.trim()) return;
    setQuizletImporting(true);
    setQuizletResult(null);
    try {
      setQuizletResult(await api.importQuizlet(quizletText, quizletName));
    } catch (error) {
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "Could not import that Quizlet export.",
      );
    } finally {
      setQuizletImporting(false);
    }
  }

  return (
    <View style={styles.root}>
      <PageHeader
        title="Import deck"
        onBack={() => goBackOrReplace("/(tabs)/create")}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={16} style={{ gap: 14 }}>
          <View style={styles.modeTabs}>
            {(["anki", "quizlet"] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  setMode(value);
                  setFile(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === value }}
                style={[styles.modeTab, mode === value && styles.modeTabActive]}
              >
                <Text style={[styles.modeLabel, mode === value && styles.modeLabelActive]}>
                  {value === "anki" ? "Anki" : "Quizlet"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.heading}>
            <FeaturedIcon icon="upload" variant="brand" size="sm" />
            <Text style={styles.headingText}>
              {mode === "anki" ? "Anki package (.apkg)" : "Quizlet export"}
            </Text>
          </View>
          <Text style={styles.body}>
            {mode === "anki"
              ? "Cards and images are imported. Audio is skipped."
              : "Export from Quizlet with tabs between terms and definitions, then paste or upload it here."}
          </Text>

          <Pressable
            onPress={() => void pickFile()}
            style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
          >
            <FeaturedIcon icon={file ? "checkCircle" : "upload"} variant={file ? "easy" : "gray"} size="lg" />
            <Text style={styles.dropzoneTitle}>
              {file
                ? file.name
                : mode === "anki"
                  ? "Tap to choose a .apkg file"
                  : "Tap to choose a Quizlet export"}
            </Text>
            <Text style={styles.dropzoneSub}>
              {file && file.size != null
                ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                : mode === "anki"
                  ? `Anki / AnkiDroid export · up to ${MAX_GB} GB`
                  : ".txt, .tsv, or .csv · up to 5 MB"}
            </Text>
          </Pressable>

          {mode === "anki" ? (
            <>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.fieldLabel}>Keep scheduling</Text>
                  <Text style={styles.toggleSub}>
                    Due dates, FSRS state &amp; deck preset. Off imports cards as new.
                  </Text>
                </View>
                <Switch
                  value={keepScheduling}
                  onValueChange={setKeepScheduling}
                  trackColor={{ false: colors.gray200, true: colors.brand600 }}
                  thumbColor={colors.bgSurface}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={styles.fieldLabel}>Combine into one deck (optional)</Text>
                <Field
                  leadingIcon="folder"
                  value={combineName}
                  onChangeText={setCombineName}
                  placeholder="Leave blank to keep Anki deck names"
                />
              </View>
            </>
          ) : (
            <>
              <View style={{ gap: 6 }}>
                <Text style={styles.fieldLabel}>Exported cards</Text>
                <Field
                  value={quizletText}
                  onChangeText={(value) => {
                    setQuizletText(value);
                    setQuizletResult(null);
                  }}
                  placeholder={"Term 1\tDefinition 1\nTerm 2\tDefinition 2"}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                  containerStyle={styles.textareaContainer}
                  inputStyle={styles.textarea}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={styles.fieldLabel}>Deck name</Text>
                <Field
                  leadingIcon="folder"
                  value={quizletName}
                  onChangeText={setQuizletName}
                  placeholder="Quizlet import"
                />
              </View>
            </>
          )}

          <Button
            variant="brand"
            size="xl"
            label={
              importing
                ? mode === "anki"
                  ? "Importing in background…"
                  : "Importing…"
                : "Import deck"
            }
            leadingIcon="upload"
            loading={importing}
            disabled={
              importing || (mode === "anki" ? !file : !quizletText.trim())
            }
            onPress={() => void runImport()}
            fullWidth
          />

          {mode === "anki" && importTask && importTask.status !== "ready" && (
            <Card padding={14} style={{ gap: 10 }}>
              <Text style={styles.progressTitle}>{taskPhaseLabel(importTask)}</Text>
              {importTask.status === "running" ? (
                <>
                  <ProgressBar value={importTask.progress / 100} />
                  <Text style={styles.progressHint}>You can switch tabs while this runs.</Text>
                </>
              ) : importTask.status === "failed" ? (
                <Text style={styles.progressError}>{importTask.error ?? "Import failed"}</Text>
              ) : null}
            </Card>
          )}
        </Card>

        {result && (
          <Card padding={16} style={{ gap: 12 }}>
            <View style={styles.heading}>
              <FeaturedIcon icon="checkCircle" variant="easy" size="sm" />
              <Text style={styles.headingText}>
                Imported {result.cardsImported} card{result.cardsImported === 1 ? "" : "s"}
              </Text>
            </View>
            <View style={{ gap: 4 }}>
              <Text style={styles.stat}>
                {result.scheduledImported > 0
                  ? `${result.scheduledImported} cards with scheduling restored`
                  : "Cards imported as new (no scheduling)"}
              </Text>
              {result.suspendedImported > 0 && (
                <Text style={styles.stat}>{result.suspendedImported} suspended cards</Text>
              )}
              {result.mediaImported > 0 && (
                <Text style={styles.stat}>{result.mediaImported} images imported</Text>
              )}
              {result.fsrsPresetsApplied > 0 && (
                <Text style={styles.stat}>
                  {result.fsrsPresetsApplied} FSRS preset(s) applied at the deck level
                </Text>
              )}
            </View>

            <View style={{ gap: 8 }}>
              {result.decks.map((deck) => (
                <View key={deck.id} style={styles.deckRow}>
                  <Icon name="folder" size={18} color={colors.fgSecondary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.deckName} numberOfLines={1}>
                      {deck.name}
                    </Text>
                    <Text style={styles.deckCount}>{deck.cardCount} cards</Text>
                  </View>
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Study"
                    onPress={() => router.push(`/(tabs)/study/${deck.id}`)}
                  />
                </View>
              ))}
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    modeTabs: {
      flexDirection: "row",
      gap: 4,
      padding: 3,
      borderRadius: radius.lg,
      backgroundColor: colors.gray100,
    },
    modeTab: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 8,
      borderRadius: radius.md,
    },
    modeTabActive: { backgroundColor: colors.bgSurface },
    modeLabel: { fontSize: 13, fontWeight: "500", color: colors.fgTertiary },
    modeLabelActive: { color: colors.brand700 },
    heading: { flexDirection: "row", alignItems: "center", gap: 10 },
    headingText: { fontSize: 16, fontWeight: "600", color: colors.fgPrimary, flex: 1 },
    body: { fontSize: 13, lineHeight: 19, color: colors.fgTertiary },
    fieldLabel: { fontSize: 13, fontWeight: "500", color: colors.fgSecondary },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 4,
    },
    toggleSub: { fontSize: 12, lineHeight: 17, color: colors.fgQuaternary, marginTop: 2 },
    dropzone: {
      padding: 28,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: radius.lg,
      backgroundColor: colors.gray50,
      alignItems: "center",
      gap: 6,
    },
    dropzoneTitle: { fontSize: 14, fontWeight: "500", color: colors.fgSecondary, marginTop: 8 },
    dropzoneSub: { fontSize: 12, color: colors.fgQuaternary },
    textareaContainer: { alignItems: "flex-start", minHeight: 150 },
    textarea: { minHeight: 130 },
    progressTitle: { fontSize: 14, fontWeight: "600", color: colors.fgPrimary },
    progressHint: { fontSize: 12, color: colors.fgQuaternary },
    progressError: { fontSize: 13, color: colors.gradeAgain },
    stat: { fontSize: 13, color: colors.fgTertiary },
    deckRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.gray50,
    },
    deckName: { fontSize: 14, fontWeight: "600", color: colors.fgPrimary },
    deckCount: { fontSize: 12, color: colors.fgQuaternary, marginTop: 2 },
  });
}
