import type { CramSelectorOptions } from "@deephaus/api-client";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { deviceTimeZone, formatDeadline } from "@/lib/cram";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const DEADLINE_CHOICES = [
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 60, label: "2 months" },
];

const RETENTION_CHOICES = [
  { value: 0.85, label: "85%" },
  { value: 0.9, label: "90%" },
  { value: 0.95, label: "95%" },
];

const MINUTES_CHOICES = [10, 20, 30, 45, 60];

function deadlineFromDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // End of the chosen day so the whole day is available for studying.
  date.setHours(23, 59, 0, 0);
  return date;
}

export default function CreateCramPlanScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [options, setOptions] = useState<CramSelectorOptions["options"] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const [deadlineDays, setDeadlineDays] = useState(7);
  const [retention, setRetention] = useState(0.9);
  const [dailyMinutes, setDailyMinutes] = useState(20);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void api
      .getCramPlanOptions()
      .then((result) => setOptions(result.options))
      .catch((e) =>
        setOptionsError(e instanceof Error ? e.message : "Could not load decks."),
      );
  }, []);

  const selectedCardCount = useMemo(() => {
    if (!options) return 0;
    return options.decks
      .filter((deck) => selectedDecks.has(deck.id))
      .reduce((sum, deck) => sum + deck.card_count, 0);
  }, [options, selectedDecks]);

  function toggleDeck(id: string) {
    setSelectedDecks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const deadlineDate = deadlineFromDays(deadlineDays);
  const canCreate =
    name.trim().length > 0 && selectedDecks.size > 0 && selectedCardCount > 0 && !creating;

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const detail = await api.createCramPlan({
        name: name.trim(),
        deadline_at: deadlineFromDays(deadlineDays).toISOString(),
        deadline_timezone: deviceTimeZone(),
        deadline_has_time: false,
        target_retention: retention,
        daily_minutes: dailyMinutes,
        deck_ids: Array.from(selectedDecks),
      });
      router.replace(`/(tabs)/study/cram/${detail.plan.id}`);
    } catch (e) {
      Alert.alert(
        "Could not create plan",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.root}>
      <PageHeader title="New Cram Plan" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Plan name</Text>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="e.g. Biology final"
            autoFocus
          />
        </Card>

        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Decks</Text>
          {!options && !optionsError && (
            <ActivityIndicator color={colors.brand500} style={{ paddingVertical: 12 }} />
          )}
          {optionsError && (
            <View style={styles.optionsError}>
              <FeaturedIcon icon="warning" variant="orange" size="sm" />
              <Text style={styles.optionsErrorText}>{optionsError}</Text>
            </View>
          )}
          {options && options.decks.length === 0 && (
            <Text style={styles.helper}>
              You need at least one deck with cards to create a Cram Plan.
            </Text>
          )}
          {options?.decks.map((deck) => {
            const active = selectedDecks.has(deck.id);
            return (
              <Pressable
                key={deck.id}
                onPress={() => toggleDeck(deck.id)}
                style={[styles.deckOption, active && styles.deckOptionActive]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.deckName} numberOfLines={1}>
                    {deck.name}
                  </Text>
                  <Text style={styles.deckCount}>
                    {deck.card_count} card{deck.card_count === 1 ? "" : "s"}
                  </Text>
                </View>
                <View style={[styles.checkbox, active && styles.checkboxActive]}>
                  {active && <Icon name="check" size={14} color={colors.bgSurface} />}
                </View>
              </Pressable>
            );
          })}
          {selectedDecks.size > 0 && (
            <Text style={styles.helper}>
              {selectedCardCount} card{selectedCardCount === 1 ? "" : "s"} selected
            </Text>
          )}
        </Card>

        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Deadline</Text>
          <View style={styles.chipRow}>
            {DEADLINE_CHOICES.map((choice) => {
              const active = choice.days === deadlineDays;
              return (
                <Pressable
                  key={choice.days}
                  onPress={() => setDeadlineDays(choice.days)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.helper}>
            Deadline: {formatDeadline(deadlineDate.toISOString())}
          </Text>
        </Card>

        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Target retention</Text>
          <View style={styles.chipRow}>
            {RETENTION_CHOICES.map((choice) => {
              const active = choice.value === retention;
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => setRetention(choice.value)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Daily study time</Text>
          <View style={styles.chipRow}>
            {MINUTES_CHOICES.map((minutes) => {
              const active = minutes === dailyMinutes;
              return (
                <Pressable
                  key={minutes}
                  onPress={() => setDailyMinutes(minutes)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {minutes} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Button
          variant="brand"
          size="xl"
          label={creating ? "Creating…" : "Create Cram Plan"}
          leadingIcon="calendar"
          disabled={!canCreate}
          onPress={() => void create()}
          fullWidth
        />
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    helper: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgQuaternary,
    },
    optionsError: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    optionsErrorText: {
      flex: 1,
      fontSize: 13,
      color: colors.fgTertiary,
    },
    deckOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
    },
    deckOptionActive: {
      borderColor: colors.brand600,
      backgroundColor: colors.gray50,
    },
    deckName: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    deckCount: {
      fontSize: 12,
      color: colors.fgTertiary,
      marginTop: 1,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.borderPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxActive: {
      backgroundColor: colors.brand600,
      borderColor: colors.brand600,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    chip: {
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: 999,
      backgroundColor: colors.bgSurface,
    },
    chipActive: {
      borderColor: colors.brand600,
      backgroundColor: colors.brand50,
    },
    chipText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgTertiary,
    },
    chipTextActive: {
      color: colors.brand700,
    },
  });
}
