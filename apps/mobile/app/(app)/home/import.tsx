import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, type QuizletImportResponse, type QuizletIncompleteRowsError } from "@deephaus/api-client";
import { MAX_APKG_BYTES } from "@deephaus/shared";
import { Button } from "@/components/ui/button";
import { DeckLogo } from "@/components/ui/deck-logo";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api } from "@/lib/api";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
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
    await importQuizlet(false);
  }

  async function importQuizlet(skipIncompleteRows: boolean) {
    setQuizletImporting(true);
    setQuizletResult(null);
    try {
      setQuizletResult(
        await api.importQuizlet(quizletText, quizletName, { skipIncompleteRows }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "incomplete_rows") {
        const { cardsFound } = error.body as QuizletIncompleteRowsError;
        Alert.alert("Some rows are incomplete", error.message, [
          { text: "Cancel", style: "cancel" },
          {
            text: `Import ${cardsFound} card${cardsFound === 1 ? "" : "s"}`,
            onPress: () => void importQuizlet(true),
          },
        ]);
        return;
      }
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
      <ScreenHeader title="Import deck" backFallback="/home" />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <SegmentedControl
          options={[
            { value: "anki", label: "Anki" },
            { value: "quizlet", label: "Quizlet" },
          ]}
          value={mode}
          accessibilityLabel="Import source"
          onChange={(value) => {
            setMode(value);
            setFile(null);
          }}
        />

        <View style={styles.intro}>
          <Text style={styles.title}>
            {mode === "anki" ? "Anki package (.apkg)" : "Quizlet export"}
          </Text>
          <Text style={styles.body}>
            {mode === "anki"
              ? "Cards, images and audio clips are imported. Video is skipped."
              : "Export from Quizlet with tabs between terms and definitions, then paste or upload it here."}
          </Text>
        </View>

        <Pressable
          onPress={() => void pickFile()}
          style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
        >
          <Icon
            name={file ? "checkCircle" : "upload"}
            size={24}
            color={file ? colors.accent : colors.fgTertiary}
          />
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
                <Text style={styles.toggleLabel}>Keep scheduling</Text>
                <Text style={styles.toggleSub}>
                  Due dates, FSRS state and deck preset. Off imports cards as new.
                </Text>
              </View>
              <Switch
                value={keepScheduling}
                onValueChange={setKeepScheduling}
                trackColor={{ false: colors.bgActive, true: colors.accent }}
                thumbColor={colors.white}
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
          variant="primary"
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
          <View style={styles.section}>
            <Text style={styles.progressTitle}>{taskPhaseLabel(importTask)}</Text>
            {importTask.status === "running" ? (
              <>
                <ProgressBar value={importTask.progress / 100} />
                <Text style={styles.progressHint}>You can switch tabs while this runs.</Text>
              </>
            ) : importTask.status === "failed" ? (
              <Text style={styles.progressError}>{importTask.error ?? "Import failed"}</Text>
            ) : null}
          </View>
        )}

        {result && (
          <View style={styles.section}>
            <Text style={styles.title}>
              Imported {result.cardsImported} card{result.cardsImported === 1 ? "" : "s"}
            </Text>
            <View style={{ gap: 4 }}>
              <Text style={styles.stat}>
                {result.scheduledImported > 0
                  ? `${result.scheduledImported} cards with scheduling restored`
                  : "Cards imported as new (no scheduling)"}
              </Text>
              {mode === "quizlet" && (quizletResult?.skippedRows?.length ?? 0) > 0 && (
                <Text style={styles.stat}>
                  {quizletResult!.skippedRows!.length} incomplete row
                  {quizletResult!.skippedRows!.length === 1 ? "" : "s"} skipped
                </Text>
              )}
              {result.suspendedImported > 0 && (
                <Text style={styles.stat}>{result.suspendedImported} suspended cards</Text>
              )}
              {(result.reviewLogsImported ?? 0) > 0 && (
                <Text style={styles.stat}>{result.reviewLogsImported} past reviews imported</Text>
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

            <View>
              {result.decks.map((deck, index) => (
                <View key={deck.id} style={[styles.deckRow, index > 0 && styles.deckRowLine]}>
                  <DeckLogo />
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
                    onPress={() => router.push(`/study/${deck.id}`)}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 16 },
    intro: { gap: 4 },
    title: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: colors.fgPrimary },
    body: { fontSize: 14, lineHeight: 20, color: colors.fgTertiary },
    fieldLabel: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      borderTopColor: colors.line,
      borderTopWidth: 1,
      borderBottomColor: colors.line,
      borderBottomWidth: 1,
    },
    toggleLabel: { fontSize: 15, lineHeight: 21, color: colors.fgPrimary },
    toggleSub: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary, marginTop: 2 },
    dropzone: {
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderColor: colors.lineStrong,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: radius.xl3,
      backgroundColor: colors.bgSurface,
      alignItems: "center",
      gap: 4,
    },
    dropzoneTitle: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
      textAlign: "center",
      marginTop: 4,
    },
    dropzoneSub: { fontSize: 12, lineHeight: 17, color: colors.fgTertiary, textAlign: "center" },
    textareaContainer: { alignItems: "flex-start", minHeight: 150 },
    textarea: { minHeight: 130 },
    section: {
      gap: 10,
      paddingTop: 16,
      borderTopColor: colors.line,
      borderTopWidth: 1,
    },
    progressTitle: { fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    progressHint: { fontSize: 12, lineHeight: 17, color: colors.fgTertiary },
    progressError: { fontSize: 13, lineHeight: 18, color: colors.danger },
    stat: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    deckRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingVertical: 10,
    },
    deckRowLine: { borderTopColor: colors.line, borderTopWidth: 1 },
    deckName: { fontSize: 16, lineHeight: 22, fontWeight: "500", color: colors.fgPrimary },
    deckCount: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
  });
}
