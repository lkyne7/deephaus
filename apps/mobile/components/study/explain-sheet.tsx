import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CardExplainState, CardFieldFix } from "@deephaus/api-client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { NativeSheet } from "@/components/ui/native-sheet";
import { api } from "@/lib/api";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import {
  askAboutCard,
  explainErrorMessage,
  hasExplainContent,
  readSavedExplanation,
  writeExplanation,
  type ExplainCard,
} from "@/lib/study/explain";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const FOLLOW_UPS = [
  { label: "Simpler", message: "Explain it more simply." },
  { label: "Example", message: "Give me one concrete example." },
  { label: "Quiz me", message: "Ask me one quick question to check I understand this." },
  { label: "Fix card", message: "Is anything wrong or unclear on this card? If so, suggest a fix." },
  { label: "Add a card", message: "Suggest one new card that would help me remember this." },
];

/** Another card's text as one plain line: no tags, Markdown marks or math fences. */
function plainLine(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELD_LABELS: Record<keyof CardFieldFix, string> = {
  front: "Front",
  back: "Back",
  cloze_text: "Text",
  extra: "Extra",
};

/**
 * Explain, after the answer is shown: a saved, grounded explanation with
 * follow-up questions. Reopening is free and works offline once synced; a new
 * explanation or a question costs 1 credit. Keep it mounted so it animates out.
 */
export function ExplainSheet({
  card,
  visible,
  onClose,
  onCardFixed,
}: {
  card: ExplainCard;
  visible: boolean;
  onClose: () => void;
  onCardFixed?: (fields: Partial<ExplainCard> & { id: string }) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState<CardExplainState | null>(null);
  const [phase, setPhase] = useState<"reading" | "writing" | "asking" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function write(rewrite = false) {
    setPhase("writing");
    setError(null);
    try {
      setState(await writeExplanation(card, "explain", rewrite));
    } catch (err) {
      setError(await explainErrorMessage(err, "write"));
    } finally {
      setPhase(null);
    }
  }

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setState(null);
    setError(null);
    setQuoteOpen(false);
    setPhase("reading");
    void (async () => {
      const saved = await readSavedExplanation(card, "explain");
      if (cancelled) return;
      setState(saved);
      setPhase(null);
      // Opening Explain is the request: write one when nothing is saved.
      if (!hasExplainContent(saved, "explain")) void write();
    })();
    return () => {
      cancelled = true;
    };
    // Re-read when the sheet opens or the card changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, card.id]);

  async function ask(message: string) {
    const text = message.trim();
    if (!text || phase) return;
    haptics.selection();
    setPhase("asking");
    setError(null);
    try {
      setState(await askAboutCard(card, text));
      setQuestion("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setError(await explainErrorMessage(err, "ask"));
    } finally {
      setPhase(null);
    }
  }

  async function apply(target: { from: "explanation" } | { message_index: number }) {
    setError(null);
    try {
      const result = await api.applyExplainSuggestion(card.id, target);
      setState(result.state);
      if (result.card) onCardFixed?.(result.card);
      haptics.success();
    } catch (err) {
      setError(await explainErrorMessage(err, "write"));
    }
  }

  const explanation = state?.explanation ?? null;
  const thread = state?.thread ?? [];
  // A conversation can outlive its explanation: a question about a card that
  // has changed starts a new one with no explanation yet. Keep it on screen.
  const hasContent = explanation != null || thread.length > 0;
  const busy = phase === "reading" || phase === "writing";

  return (
    <NativeSheet
      visible={visible}
      onClose={onClose}
      title="Explain"
      detents={["medium", "large"]}
      leading={
        hasContent ? (
          <Pressable
            onPress={() => void write(true)}
            disabled={!!phase}
            accessibilityRole="button"
            accessibilityLabel="Write a new explanation, 1 credit"
            hitSlop={8}
            style={styles.headerButton}
          >
            <Icon name="refresh" size={16} color={colors.fgSecondary} />
          </Pressable>
        ) : undefined
      }
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {busy ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.muted}>
                {phase === "writing" ? "Writing an explanation…" : "Loading…"}
              </Text>
            </View>
          ) : null}

          {!busy && state?.stale && explanation ? (
            <View style={styles.stale}>
              <Text style={styles.staleText}>This card changed since this was written.</Text>
              <Button label="Write a new one · 1 credit" size="sm" variant="secondary" onPress={() => void write(true)} />
            </View>
          ) : null}

          {!busy && explanation ? (
            <>
              <Text style={styles.gist}>{explanation.gist}</Text>
              {explanation.why.map((line, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.bodyText}>{line}</Text>
                </View>
              ))}

              {state?.source?.quote ? (
                <Pressable
                  style={styles.source}
                  onPress={() => setQuoteOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: quoteOpen }}
                >
                  <View style={styles.sourceRow}>
                    <Icon name="book" size={16} color={colors.fgTertiary} />
                    <View style={styles.flex}>
                      <Text style={styles.sourceLabel}>From your source</Text>
                      <Text style={styles.sourceTitle} numberOfLines={1}>
                        {state.source.title || "Your source"}
                      </Text>
                    </View>
                    <Text style={styles.link}>{quoteOpen ? "Hide" : "Show"}</Text>
                  </View>
                  {quoteOpen ? <Text style={styles.quote}>{state.source.quote}</Text> : null}
                </Pressable>
              ) : null}

              {explanation.confusable && state?.confusable ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Don't confuse with</Text>
                  <View style={styles.boxed}>
                    {state.confusable.type !== "cloze" && state.confusable.front ? (
                      <Text style={styles.boxedQuestion} numberOfLines={2}>
                        {plainLine(state.confusable.front)}
                      </Text>
                    ) : null}
                    <Text style={styles.boxedTitle}>
                      {plainLine(
                        state.confusable.type === "cloze"
                          ? state.confusable.cloze_text?.replace(/\{\{c\d+::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g, "$1")
                          : state.confusable.back,
                      )}
                    </Text>
                    <Text style={styles.bodySecondary}>{explanation.confusable.note}</Text>
                  </View>
                </View>
              ) : null}

              {explanation.hook ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Memory hook</Text>
                  <Text style={styles.bodyText}>{explanation.hook}</Text>
                </View>
              ) : null}

              {explanation.card_issue && !state?.stale ? (
                <FixSuggestion
                  styles={styles}
                  problem={explanation.card_issue.problem}
                  fix={explanation.card_issue.fix}
                  card={card}
                  onApply={() => void apply({ from: "explanation" })}
                />
              ) : null}
            </>
          ) : null}

          {!busy && hasContent ? (
            <>
              {thread.map((message, i) =>
                message.role === "user" ? (
                  <Text key={i} style={styles.bubble}>
                    {message.text}
                  </Text>
                ) : (
                  <View key={i} style={styles.reply}>
                    <Text style={styles.bodyText}>{message.text}</Text>
                    {message.suggestion?.kind === "fix" ? (
                      <FixSuggestion
                        styles={styles}
                        fix={message.suggestion.fix}
                        card={card}
                        applied={message.suggestion.applied}
                        onApply={() => void apply({ message_index: i })}
                      />
                    ) : null}
                    {message.suggestion?.kind === "new_card" ? (
                      <View style={styles.suggestion}>
                        <Text style={styles.suggestionTitle}>New card from this answer</Text>
                        <Text style={styles.bodyText}>{message.suggestion.front}</Text>
                        <Text style={styles.bodySecondary}>{message.suggestion.back}</Text>
                        {message.suggestion.added ? (
                          <Text style={styles.done}>Added to this deck</Text>
                        ) : (
                          <Button label="Add to deck" size="sm" variant="primary" pill onPress={() => void apply({ message_index: i })} />
                        )}
                      </View>
                    ) : null}
                  </View>
                ),
              )}
              {phase === "asking" ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.muted}>Thinking…</Text>
                </View>
              ) : null}
            </>
          ) : null}

          {error && !hasContent ? <Text style={styles.error}>{error}</Text> : null}
          {!busy && !hasContent && error ? (
            <Button label="Try again" size="sm" variant="secondary" onPress={() => void write()} />
          ) : null}
        </ScrollView>

        {hasContent ? (
          <View style={styles.composer}>
            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.chips}
            >
              {FOLLOW_UPS.map((chip) => (
                <Pressable
                  key={chip.label}
                  style={[styles.chip, phase ? styles.disabled : null]}
                  onPress={() => void ask(chip.message)}
                  disabled={!!phase}
                  accessibilityRole="button"
                >
                  <Text style={styles.chipText}>{chip.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={question}
                onChangeText={setQuestion}
                placeholder={thread.length > 0 ? "Ask a follow-up" : "Ask about this card"}
                placeholderTextColor={colors.fgTertiary}
                returnKeyType="send"
                onSubmitEditing={() => void ask(question)}
                maxLength={1000}
                editable={phase !== "asking"}
                accessibilityLabel="Ask about this card"
              />
              <Pressable
                style={[styles.send, !question.trim() || phase ? styles.sendDisabled : null]}
                onPress={() => void ask(question)}
                disabled={!question.trim() || !!phase}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                <Icon name="arrowUp" size={17} color={!question.trim() || phase ? colors.fgTertiary : colors.actionPrimaryFg} />
              </Pressable>
            </View>
            <Text style={styles.note}>Reopening is free. Each question uses 1 credit.</Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </NativeSheet>
  );
}

function FixSuggestion({
  styles,
  problem,
  fix,
  card,
  applied,
  onApply,
}: {
  styles: ReturnType<typeof createStyles>;
  problem?: string;
  fix: CardFieldFix;
  card: ExplainCard;
  applied?: boolean;
  onApply: () => void;
}) {
  const fields = (Object.keys(fix) as Array<keyof CardFieldFix>).filter((key) => fix[key] != null);
  return (
    <View style={styles.suggestion}>
      <Text style={styles.suggestionTitle}>Suggested fix to this card</Text>
      {problem ? <Text style={styles.bodySecondary}>{problem}</Text> : null}
      {fields.map((key) => (
        <View key={key} style={styles.diff}>
          <Text style={styles.diffLabel}>{FIELD_LABELS[key]}</Text>
          {/* Once applied, the card already reads as the fix: nothing was removed from that. */}
          {card[key] && !(applied && card[key] === fix[key]) ? (
            <Text style={styles.removed}>{card[key]}</Text>
          ) : null}
          <Text style={styles.added}>{fix[key]}</Text>
        </View>
      ))}
      {applied ? (
        <Text style={styles.done}>Applied to the card</Text>
      ) : (
        <Button label="Apply" size="sm" variant="primary" pill onPress={onApply} />
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    body: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, gap: 14 },
    headerButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bgSunken,
    },
    loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 20 },
    muted: { fontSize: 14, lineHeight: 20, color: colors.fgTertiary },
    error: { fontSize: 13, lineHeight: 18, color: colors.fgError },
    stale: { gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.bgSunken },
    staleText: { fontSize: 14, lineHeight: 19, color: colors.fgSecondary },
    gist: { ...serifFont(500), fontSize: 18, lineHeight: 26, color: colors.fgPrimary },
    bulletRow: { flexDirection: "row", gap: 8, paddingRight: 8 },
    bullet: { ...serifFont(400), fontSize: 16, lineHeight: 24, color: colors.fgTertiary },
    bodyText: { ...serifFont(400), flexShrink: 1, fontSize: 16, lineHeight: 24, color: colors.fgPrimary },
    bodySecondary: { ...serifFont(400), fontSize: 15.5, lineHeight: 23, color: colors.fgSecondary },
    source: { gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.bgSunken },
    sourceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    sourceLabel: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    sourceTitle: { fontSize: 14, lineHeight: 19, fontWeight: "500", color: colors.fgPrimary },
    link: { fontSize: 14, fontWeight: "600", color: colors.accentInk },
    quote: { ...serifFont(400, true), fontSize: 15.5, lineHeight: 23, color: colors.fgSecondary },
    section: { gap: 6 },
    sectionLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0.4, color: colors.fgTertiary, textTransform: "uppercase" },
    boxed: { gap: 2, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
    boxedQuestion: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    boxedTitle: { ...serifFont(500), fontSize: 16, lineHeight: 23, color: colors.fgPrimary },
    bubble: {
      alignSelf: "flex-end",
      maxWidth: "82%",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 18,
      overflow: "hidden",
      backgroundColor: colors.bgSunken,
      fontSize: 16,
      lineHeight: 21,
      color: colors.fgPrimary,
    },
    reply: { gap: 10 },
    suggestion: { gap: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.lineStrong },
    suggestionTitle: { fontSize: 14, lineHeight: 19, fontWeight: "600", color: colors.fgPrimary },
    diff: { gap: 4 },
    diffLabel: { fontSize: 12, fontWeight: "500", color: colors.fgTertiary },
    removed: { fontSize: 15, lineHeight: 21, color: colors.fgError, textDecorationLine: "line-through" },
    added: { fontSize: 15, lineHeight: 21, color: colors.accentInk },
    done: { fontSize: 14, fontWeight: "500", color: colors.accentInk },
    composer: {
      gap: 8,
      paddingTop: 10,
      paddingHorizontal: 12,
      paddingBottom: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    chips: { gap: 8, paddingHorizontal: 4 },
    chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: colors.bgSunken },
    chipText: { fontSize: 15, fontWeight: "500", color: colors.fgPrimary },
    disabled: { opacity: 0.5 },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 16,
      paddingRight: 5,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.lineStrong,
    },
    input: { flex: 1, minHeight: 34, fontSize: 17, color: colors.fgPrimary },
    send: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.actionPrimaryBg,
    },
    sendDisabled: { backgroundColor: colors.bgSunken },
    note: { paddingHorizontal: 4, fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
  });
}
