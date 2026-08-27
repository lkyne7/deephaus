import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  DeckActionsSheet,
  type DeckActionsDeck,
} from "@/components/deck-actions-sheet";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { PageHeader, PageHeaderIconButton } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { Project } from "@deephaus/shared";

export default function CreateScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [deckName, setDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionsDeck, setActionsDeck] = useState<DeckActionsDeck | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await offlineData.listProjects());
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject() {
    if (!name.trim() || !deckName.trim()) return;
    setCreating(true);
    try {
      const project = await api.createProject({
        name: name.trim(),
        deck_name: deckName.trim(),
      });
      setName("");
      setDeckName("");
      router.push(`/(tabs)/create/${project.id}`);
    } catch (e) {
      Alert.alert(
        "Could not create project",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.root}>
      <PageHeader
        title="Create"
        right={
          <PageHeaderIconButton
            icon="upload"
            label="Import from Anki or Quizlet"
            onPress={() => router.push("/(tabs)/create/import")}
          />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.brand500}
          />
        }
      >
        {/* New project card */}
        <Card padding={16} style={{ gap: 12 }}>
          <View style={styles.heading}>
            <FeaturedIcon icon="sparkles" variant="brand" size="sm" />
            <Text style={styles.headingText}>New project</Text>
          </View>
          <View style={{ gap: 8 }}>
            <View>
              <Text style={styles.fieldLabel}>Project name</Text>
              <Field
                leadingIcon="bookmark"
                value={name}
                onChangeText={setName}
                placeholder="e.g. USMLE Step 1"
              />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Deck name</Text>
              <Field
                leadingIcon="folder"
                value={deckName}
                onChangeText={setDeckName}
                placeholder="e.g. Cardiology"
              />
            </View>
          </View>
          <Button
            variant="brand"
            size="lg"
            label="Create project"
            leadingIcon="add"
            disabled={!name.trim() || !deckName.trim() || creating}
            loading={creating}
            onPress={() => void createProject()}
          />
        </Card>

        {/* Projects list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your projects</Text>
          {loading ? (
            <ActivityIndicator color={colors.brand500} style={{ marginTop: 12 }} />
          ) : projects.length === 0 ? (
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="folder" variant="gray" size="lg" />
              <Text style={styles.emptyTitle}>No projects yet</Text>
              <Text style={styles.emptyBody}>
                Create a project to start generating decks from your notes, PDFs, or
                YouTube videos.
              </Text>
            </Card>
          ) : (
            <View style={styles.projectList}>
              {projects.map((project) => (
                <Pressable
                  key={project.id}
                  onPress={() => router.push(`/(tabs)/create/${project.id}`)}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <Card padding={14} style={{ gap: 10 }}>
                    <View style={styles.titleRow}>
                      <Icon name="folder" size={18} color={colors.fgSecondary} />
                      <Text style={styles.projectName}>{project.name}</Text>
                      <Pressable
                        onPress={() =>
                          setActionsDeck({
                            id: project.id,
                            title: project.deck_name || project.name,
                          })
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Actions for ${project.deck_name || project.name}`}
                        style={styles.moreBtn}
                      >
                        <Icon name="more" size={18} color={colors.fgQuaternary} />
                      </Pressable>
                    </View>
                    <View style={styles.badges}>
                      <BadgePill icon="book" label={project.deck_name} tone="gray" />
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <DeckActionsSheet
        visible={actionsDeck != null}
        deck={actionsDeck}
        omit={["open", "create"]}
        onClose={() => setActionsDeck(null)}
        onRenamed={(nextName) => {
          if (!actionsDeck) return;
          setProjects((prev) =>
            prev.map((p) =>
              p.id === actionsDeck.id
                ? { ...p, name: nextName, deck_name: nextName }
                : p,
            ),
          );
          setActionsDeck((prev) => (prev ? { ...prev, title: nextName } : prev));
        }}
        onDuplicated={() => {
          void load();
        }}
        onDeleted={(deckId) => {
          setProjects((prev) => prev.filter((p) => p.id !== deckId));
          setActionsDeck(null);
        }}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { padding: 16, gap: 12 },
    heading: { flexDirection: "row", alignItems: "center", gap: 10 },
    headingText: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginBottom: 6,
    },
    section: { gap: 8 },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      paddingHorizontal: 4,
    },
    empty: { alignItems: "center", gap: 4 },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    projectList: { gap: 8 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    moreBtn: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      marginRight: -4,
    },
    projectName: {
      flex: 1,
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
  });
}
