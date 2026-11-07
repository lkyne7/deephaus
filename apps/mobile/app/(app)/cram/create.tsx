import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import type { CramSelectorOptions } from "@deephaus/api-client";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/button";
import { DeckSelect } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { deckDisplayName } from "@/lib/deck-name";
import { api } from "@/lib/api";
import { deviceTimeZone, formatDeadline } from "@/lib/cram";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const CUSTOM_DEADLINE = "custom";

const DEADLINE_CHOICES = [
  { id: "3", label: "3 days" },
  { id: "7", label: "1 week" },
  { id: "14", label: "2 weeks" },
  { id: "30", label: "1 month" },
  { id: "60", label: "2 months" },
  { id: CUSTOM_DEADLINE, label: "Custom date" },
];

const RETENTION_CHOICES = [
  { value: "0.85", label: "85%" },
  { value: "0.9", label: "90%" },
  { value: "0.95", label: "95%" },
];

const MINUTES_CHOICES = [
  { value: "10", label: "10 min" },
  { value: "20", label: "20 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
];

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
  const [customDeadline, setCustomDeadline] = useState<Date | null>(null);
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

  const deadlineDate = customDeadline ?? deadlineFromDays(deadlineDays);
  const deadlineChoiceId = customDeadline ? CUSTOM_DEADLINE : String(deadlineDays);
  const deadlineChoice = DEADLINE_CHOICES.find((choice) => choice.id === deadlineChoiceId);
  const canCreate =
    name.trim().length > 0 && selectedDecks.size > 0 && selectedCardCount > 0 && !creating;

  /** Android has no combined datetime mode, so chain a date dialog into a time dialog. */
  function openCustomPicker() {
    const initial = customDeadline ?? deadlineFromDays(deadlineDays);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initial,
        mode: "date",
        minimumDate: new Date(),
        onChange: (event, date) => {
          if (event.type !== "set" || !date) return;
          DateTimePickerAndroid.open({
            value: date,
            mode: "time",
            onChange: (timeEvent, dateTime) => {
              if (timeEvent.type !== "set" || !dateTime) return;
              setCustomDeadline(dateTime);
            },
          });
        },
      });
    } else {
      setCustomDeadline(initial);
    }
  }

  function selectDeadline(id: string) {
    if (id === CUSTOM_DEADLINE) {
      openCustomPicker();
      return;
    }
    setCustomDeadline(null);
    setDeadlineDays(Number(id));
  }

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const detail = await api.createCramPlan({
        name: name.trim(),
        deadline_at: deadlineDate.toISOString(),
        deadline_timezone: deviceTimeZone(),
        deadline_has_time: customDeadline != null,
        target_retention: retention,
        daily_minutes: dailyMinutes,
        deck_ids: Array.from(selectedDecks),
      });
      router.replace(`/cram/${detail.plan.id}`);
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
      <ScreenHeader title="New plan" backFallback="/cram" />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            What are you cramming for?
          </Text>
          <Field
            accessibilityLabel="Plan name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Biology final"
            autoFocus
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What to cover</Text>
          {!options && !optionsError && (
            <ActivityIndicator color={colors.accent} style={{ paddingVertical: 12 }} />
          )}
          {optionsError && (
            <View style={styles.optionsError}>
              <FeaturedIcon icon="warning" variant="again" size="sm" />
              <Text style={styles.optionsErrorText}>{optionsError}</Text>
            </View>
          )}
          {options && options.decks.length === 0 && (
            <Text style={styles.helper}>
              You need at least one deck with cards to create a plan.
            </Text>
          )}
          {options && options.decks.length > 0 && (
            <View style={styles.deckList}>
              {options.decks.map((deck, index) => {
                const active = selectedDecks.has(deck.id);
                return (
                  <Pressable
                    key={deck.id}
                    onPress={() => toggleDeck(deck.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    style={({ pressed }) => [
                      styles.deckOption,
                      index > 0 && styles.deckOptionDivider,
                      pressed && styles.deckOptionPressed,
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.deckName} numberOfLines={1}>
                        {deckDisplayName(deck.name)}
                      </Text>
                      <Text style={styles.helper}>
                        {deck.card_count} card{deck.card_count === 1 ? "" : "s"}
                      </Text>
                    </View>
                    {active && <Icon name="check" size={20} color={colors.accent} />}
                  </Pressable>
                );
              })}
            </View>
          )}
          {selectedDecks.size > 0 && (
            <Text style={styles.helper}>
              {selectedCardCount} card{selectedCardCount === 1 ? "" : "s"} selected
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>When is it?</Text>
          <DeckSelect
            title="Deadline"
            value={deadlineChoice?.label ?? ""}
            options={DEADLINE_CHOICES}
            selectedId={deadlineChoiceId}
            onSelect={(choice) => selectDeadline(choice.id)}
          />
          {customDeadline && Platform.OS === "ios" && (
            <DateTimePicker
              value={customDeadline}
              mode="datetime"
              display="compact"
              accentColor={colors.accent}
              minimumDate={new Date()}
              onChange={(_event, date) => {
                if (date) setCustomDeadline(date);
              }}
            />
          )}
          <Text style={styles.helper}>
            Deadline: {formatDeadline(deadlineDate.toISOString())}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How hard do you want to go?</Text>
          <Text style={styles.helper}>Target retention</Text>
          <SegmentedControl
            accessibilityLabel="Target retention"
            options={RETENTION_CHOICES}
            value={String(retention)}
            onChange={(next) => setRetention(Number(next))}
          />
          <Text style={[styles.helper, { marginTop: 6 }]}>Daily study time</Text>
          <SegmentedControl
            accessibilityLabel="Daily study time"
            options={MINUTES_CHOICES}
            value={String(dailyMinutes)}
            onChange={(next) => setDailyMinutes(Number(next))}
          />
        </View>

        <Button
          variant="primary"
          size="xl"
          label={creating ? "Creating…" : "Create plan"}
          disabled={!canCreate}
          onPress={() => void create()}
          fullWidth
          style={{ marginTop: 4 }}
        />
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 24 },
    section: {
      gap: 10,
    },
    sectionTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    helper: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    optionsError: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    optionsErrorText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgSecondary,
    },
    deckList: {
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    deckOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    deckOptionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    deckOptionPressed: {
      backgroundColor: colors.bgHover,
    },
    deckName: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
  });
}
