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
import { DeckSelectModal } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { DeckLogo } from "@/components/ui/deck-logo";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { api } from "@/lib/api";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { deckDisplayName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { Project } from "@deephaus/shared";

export default function CreateScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [deckName, setDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionsDeck, setActionsDeck] = useState<DeckActionsDeck | null>(null);
  const [newCardDeckPickerOpen, setNewCardDeckPickerOpen] = useState(false);
  const [newCardTypePickerOpen, setNewCardTypePickerOpen] = useState(false);
  const [newCardDeckId, setNewCardDeckId] = useState<string | null>(null);
  const [creatingCard, setCreatingCard] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, stats] = await Promise.all([
        offlineData.listProjects(),
        offlineData.getDashboardStats().catch(() => null),
      ]);
      setProjects(items);
      setCardCounts(
        Object.fromEntries(
          (stats?.per_deck ?? []).map((deck) => [deck.deck_id, deck.total]),
        ),
      );
    } catch {
      setProjects([]);
      setCardCounts({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDeck() {
    const title = deckName.trim();
    if (!title) return;
    setCreating(true);
    try {
      const project = await api.createProject({
        name: title,
        deck_name: title,
      });
      setDeckName("");
      router.push(`/(tabs)/create/${project.id}`);
    } catch (e) {
      Alert.alert(
        "Could not create deck",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setCreating(false);
    }
  }

  function openNewCard() {
    if (projects.length === 0) {
      Alert.alert("No decks yet", "Create a deck first, then add cards to it.");
      return;
    }
    setNewCardDeckPickerOpen(true);
  }

  async function createNewCard(type: "basic" | "cloze") {
    if (!newCardDeckId || creatingCard) return;
    setCreatingCard(true);
    try {
      const card = await offlineData.createCard({
        project_id: newCardDeckId,
        type,
        append: true,
      });
      router.push(`/(tabs)/browse/${card.id}`);
    } catch (e) {
      Alert.alert(
        "Could not create card",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setCreatingCard(false);
    }
  }

  const newCardDeckOptions = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        label: deckDisplayName(project.deck_name || project.name),
      })),
    [projects],
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Create"
        actions={[
          {
            icon: "upload",
            sfIcon: "square.and.arrow.down",
            label: "Import from Anki or Quizlet",
            onPress: () => router.push("/(tabs)/create/import"),
          },
          {
            icon: "add",
            sfIcon: "plus",
            label: "New card",
            onPress: openNewCard,
            disabled: creatingCard,
            loading: creatingCard,
          },
        ]}
      />
      <KeyboardScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
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
        <Card padding={16} style={{ gap: 12 }}>
          <View style={styles.heading}>
            <FeaturedIcon icon="sparkles" variant="brand" size="sm" />
            <Text style={styles.headingText}>New deck</Text>
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
          <Button
            variant="brand"
            size="lg"
            label="Create deck"
            leadingIcon="add"
            disabled={!deckName.trim() || creating}
            loading={creating}
            onPress={() => void createDeck()}
          />
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your decks</Text>
          {loading ? (
            <ActivityIndicator color={colors.brand500} style={{ marginTop: 12 }} />
          ) : projects.length === 0 ? (
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="folder" variant="gray" size="lg" />
              <Text style={styles.emptyTitle}>No decks yet</Text>
              <Text style={styles.emptyBody}>
                Create a deck to start generating cards from your notes, PDFs, or
                YouTube videos.
              </Text>
            </Card>
          ) : (
            <View style={styles.projectList}>
              {projects.map((project) => {
                const title = deckDisplayName(project.deck_name || project.name);
                const cards = cardCounts[project.id] ?? 0;
                return (
                <Pressable
                  key={project.id}
                  onPress={() => router.push(`/(tabs)/create/${project.id}`)}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <Card padding={14} style={{ gap: 10 }}>
                    <View style={styles.titleRow}>
                      <DeckLogo />
                      <Text style={styles.projectName}>{title}</Text>
                      <Pressable
                        onPress={() =>
                          setActionsDeck({
                            id: project.id,
                            title,
                            cardCount: cards,
                          })
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Actions for ${title}`}
                        style={styles.moreBtn}
                      >
                        <Icon name="more" size={18} color={colors.fgQuaternary} />
                      </Pressable>
                    </View>
                    <View style={styles.badges}>
                      <BadgePill
                        icon="layers"
                        label={`${cards} card${cards === 1 ? "" : "s"}`}
                        tone="gray"
                      />
                    </View>
                  </Card>
                </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      </KeyboardScreen>
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
      <DeckSelectModal
        visible={newCardDeckPickerOpen}
        onClose={() => setNewCardDeckPickerOpen(false)}
        title="New card in…"
        options={newCardDeckOptions}
        selectedId={newCardDeckId ?? undefined}
        onSelect={(opt) => {
          setNewCardDeckId(opt.id);
          setNewCardTypePickerOpen(true);
        }}
      />
      <DeckSelectModal
        visible={newCardTypePickerOpen}
        onClose={() => setNewCardTypePickerOpen(false)}
        title="Card type"
        options={[
          { id: "basic", label: "Front / Back" },
          { id: "cloze", label: "Fill-in (cloze)" },
        ]}
        onSelect={(opt) => void createNewCard(opt.id as "basic" | "cloze")}
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
