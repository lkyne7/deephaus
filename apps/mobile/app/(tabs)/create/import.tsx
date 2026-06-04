import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { MAX_APKG_BYTES } from "@deephaus/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type PickedFile = { uri: string; name: string; size: number | null };

const MAX_GB = Math.round(MAX_APKG_BYTES / (1024 * 1024 * 1024));

export default function ImportAnkiScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { tasks, startAnkiImport } = useBackgroundTasks();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [keepScheduling, setKeepScheduling] = useState(true);
  const [combineName, setCombineName] = useState("");

  const importTask = tasks.find((task) => task.kind === "anki-import");
  const result = importTask?.ankiResult ?? null;
  const importing = importTask?.status === "running";

  async function pickFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    if (!/\.(apkg|colpkg)$/i.test(asset.name)) {
      Alert.alert("Wrong file type", "Choose an Anki package (.apkg) file.");
      return;
    }
    setFile({ uri: asset.uri, name: asset.name, size: asset.size ?? null });
  }

  function runImport() {
    if (!file || importing) return;
    startAnkiImport(file.uri, file.name, {
      deckName: combineName.trim() || undefined,
      scheduling: keepScheduling,
    });
  }

  return (
    <View style={styles.root}>
      <PageHeader title="Import from Anki" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={16} style={{ gap: 14 }}>
          <View style={styles.heading}>
            <FeaturedIcon icon="upload" variant="brand" size="sm" />
            <Text style={styles.headingText}>Anki package (.apkg)</Text>
          </View>
          <Text style={styles.body}>
            Cards and images are imported. Audio is skipped.
          </Text>

          <Pressable
            onPress={() => void pickFile()}
            style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
          >
            <FeaturedIcon icon={file ? "checkCircle" : "upload"} variant={file ? "easy" : "gray"} size="lg" />
            <Text style={styles.dropzoneTitle}>{file ? file.name : "Tap to choose a .apkg file"}</Text>
            <Text style={styles.dropzoneSub}>
              {file && file.size != null
                ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                : `Anki / AnkiDroid export · up to ${MAX_GB} GB`}
            </Text>
          </Pressable>

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

          <Button
            variant="brand"
            size="xl"
            pill
            label={importing ? "Importing in background…" : "Import deck"}
            leadingIcon="upload"
            loading={importing}
            disabled={importing || !file}
            onPress={runImport}
            fullWidth
          />

          {importTask && importTask.status !== "ready" && (
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
                    pill
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
      borderColor: colors.gray200,
      borderWidth: 2,
      borderStyle: "dashed",
      borderRadius: radius.xl2,
      backgroundColor: colors.gray50,
      alignItems: "center",
      gap: 6,
    },
    dropzoneTitle: { fontSize: 14, fontWeight: "500", color: colors.fgSecondary, marginTop: 8 },
    dropzoneSub: { fontSize: 12, color: colors.fgQuaternary },
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
