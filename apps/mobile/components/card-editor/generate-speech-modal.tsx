import { DEFAULT_TTS_VOICE, MAX_TTS_CHARS, TTS_VOICES, cardTextForSpeech } from "@deephaus/shared";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { DeckSelect } from "@/components/ui/deck-select";
import { Field } from "@/components/ui/input";
import { NativeSheet } from "@/components/ui/native-sheet";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  cardId: string;
  fieldLabel: string;
  /** The field's current markup; the modal shows the words that will be read. */
  initialText: string;
  /** Called with the stored clip; the modal closes afterwards. */
  onGenerated: (clip: { url: string; title: string }) => void;
};

const VOICE_KEY = "deephaus:tts-voice";
const LANGUAGE_KEY = "deephaus:tts-language";

/** Turn a field's text into a spoken clip with OpenAI text-to-speech. */
export function GenerateSpeechModal({ visible, onClose, cardId, fieldLabel, initialText, onGenerated }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<string>(DEFAULT_TTS_VOICE);
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setText(cardTextForSpeech(initialText));
    setError(null);
    setBusy(false);
    void AsyncStorage.multiGet([VOICE_KEY, LANGUAGE_KEY]).then((pairs) => {
      const stored = Object.fromEntries(pairs);
      if (stored[VOICE_KEY]) setVoice(stored[VOICE_KEY]);
      setLanguage(stored[LANGUAGE_KEY] ?? "");
    });
  }, [visible, initialText]);

  const spoken = useMemo(() => cardTextForSpeech(text), [text]);
  const credits = Math.max(1, Math.ceil(spoken.length / 1000));
  const tooLong = spoken.length > MAX_TTS_CHARS;

  async function generate() {
    if (!spoken || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      const clip = await api.generateCardSpeech(cardId, {
        text: spoken,
        voice,
        language: language.trim() || undefined,
      });
      await AsyncStorage.multiSet([
        [VOICE_KEY, voice],
        [LANGUAGE_KEY, language.trim()],
      ]).catch(() => undefined);
      onGenerated({ url: clip.url, title: clip.title });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate speech.");
      setBusy(false);
    }
  }

  return (
    <NativeSheet
      visible={visible}
      onClose={onClose}
      title="Generate speech"
      detents={[{ height: 500 }, "large"]}
      dismissDisabled={busy}
      leading={
        <Button
          variant="secondary"
          size="md"
          iconOnly
          leadingIcon="close"
          label="Cancel"
          disabled={busy}
          onPress={onClose}
        />
      }
      trailing={
        <Button
          size="md"
          variant="brand"
          label="Generate"
          loading={busy}
          disabled={!spoken || tooLong}
          onPress={() => void generate()}
        />
      }
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View>
          <Text style={styles.label}>Text to read from the {fieldLabel.toLowerCase()}</Text>
          <Field
            accessibilityLabel="Text to read"
            multiline
            value={text}
            onChangeText={setText}
            editable={!busy}
            containerStyle={styles.textarea}
            inputStyle={styles.textareaInput}
          />
          <Text style={[styles.hint, tooLong && { color: colors.fgError }]}>
            {spoken.length} / {MAX_TTS_CHARS} characters · {credits} credit{credits === 1 ? "" : "s"}
          </Text>
        </View>

        <View>
          <Text style={styles.label}>Voice</Text>
          <DeckSelect
            title="Voice"
            value={TTS_VOICES.find((option) => option.id === voice)?.label ?? voice}
            options={[...TTS_VOICES]}
            selectedId={voice}
            disabled={busy}
            onSelect={(option) => setVoice(option.id)}
          />
        </View>

        <View>
          <Text style={styles.label}>Language (optional)</Text>
          <Field
            accessibilityLabel="Language"
            value={language}
            onChangeText={setLanguage}
            placeholder="e.g. French"
            editable={!busy}
          />
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </NativeSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 14 },
    label: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary, marginBottom: 6 },
    textarea: { minHeight: 88, alignItems: "flex-start", paddingVertical: 8 },
    textareaInput: { minHeight: 72, textAlignVertical: "top" },
    hint: { marginTop: 6, fontSize: 12, color: colors.fgTertiary },
    error: { fontSize: 13, color: colors.fgError },
  });
}
