import { DEFAULT_TTS_VOICE, MAX_TTS_CHARS, TTS_VOICES, cardTextForSpeech } from "@deephaus/shared";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Field } from "@/components/ui/input";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} accessibilityRole="none">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityRole="none">
          <View style={styles.header}>
            <Icon name="volume" size={20} color={colors.fgSecondary} />
            <Text style={styles.title}>Generate speech for the {fieldLabel.toLowerCase()}</Text>
          </View>

          <View>
            <Text style={styles.label}>Text to read</Text>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.voices}>
              {TTS_VOICES.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: voice === option.id, disabled: busy }}
                  disabled={busy}
                  onPress={() => setVoice(option.id)}
                  style={[styles.voice, voice === option.id && styles.voiceActive]}
                >
                  <Text style={[styles.voiceText, voice === option.id && styles.voiceTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
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

          <View style={styles.actions}>
            <Button variant="tertiary" onPress={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onPress={() => void generate()} disabled={busy || !spoken || tooLong}>
              {busy ? "Generating…" : "Generate clip"}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
    sheet: {
      width: "100%",
      maxWidth: 480,
      gap: 14,
      padding: 20,
      borderRadius: radius.xl,
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.fgPrimary },
    label: { fontSize: 12, fontWeight: "500", color: colors.fgSecondary, marginBottom: 6 },
    textarea: { minHeight: 88, alignItems: "flex-start", paddingVertical: 8 },
    textareaInput: { minHeight: 72, textAlignVertical: "top" },
    hint: { marginTop: 6, fontSize: 12, color: colors.fgTertiary },
    voices: { flexDirection: "row", gap: 8 },
    voice: {
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      backgroundColor: colors.bgCanvas,
      justifyContent: "center",
    },
    voiceActive: { borderColor: colors.brand500, backgroundColor: colors.brand50 },
    voiceText: { fontSize: 13, fontWeight: "600", color: colors.fgSecondary },
    voiceTextActive: { color: colors.brand700 },
    error: { fontSize: 13, color: colors.fgError },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  });
}
