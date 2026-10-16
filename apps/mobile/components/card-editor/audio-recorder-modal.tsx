import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { MAX_AUDIO_RECORDING_SECONDS } from "@deephaus/shared";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with the finished recording's file URI; the modal closes afterwards. */
  onRecorded: (uri: string) => Promise<void>;
};

/** Recordings stop here; a card clip is a word, a phrase or a short sound. */
const MAX_MILLIS = MAX_AUDIO_RECORDING_SECONDS * 1000;

function formatMillis(millis: number): string {
  const total = Math.floor(millis / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Preview({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const finished = status.duration > 0 && status.currentTime >= status.duration - 0.05;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status.playing ? "Pause preview" : "Play preview"}
      onPress={() => {
        if (status.playing) return player.pause();
        if (finished) void player.seekTo(0);
        player.play();
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}
    >
      <Icon name={status.playing ? "pausePlayback" : "play"} size={20} color={colors.brand700} />
      <Text style={{ color: colors.fgSecondary }}>
        {status.playing ? "Playing preview…" : "Play preview"}
        {status.duration > 0 ? ` (${formatMillis(status.duration * 1000)})` : ""}
      </Text>
    </Pressable>
  );
}

/** Record a clip from the microphone, preview it, and hand back its file. */
export function AudioRecorderModal({ visible, onClose, onRecorded }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRecordedUri(null);
      setError(null);
      setSaving(false);
      if (recorderState.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_MILLIS) {
      void stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording, recorderState.durationMillis]);

  async function startRecording() {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Microphone access is needed to record. Allow it in Settings and try again.");
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordedUri(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  }

  async function stopRecording() {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) {
        setError("Nothing was recorded.");
        return;
      }
      setRecordedUri(recorder.uri);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop recording.");
    }
  }

  async function useRecording() {
    if (!recordedUri) return;
    setSaving(true);
    try {
      await onRecorded(recordedUri);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the recording.");
      setSaving(false);
    }
  }

  const recording = recorderState.isRecording;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={saving ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={saving ? undefined : onClose} accessibilityRole="none">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityRole="none">
          <View style={styles.header}>
            <Icon name="mic" size={20} color={colors.fgSecondary} />
            <Text style={styles.title}>Record audio</Text>
          </View>

          <View style={styles.timerRow}>
            <View style={[styles.dot, { opacity: recording ? 1 : 0.25 }]} />
            <Text style={styles.timer}>{formatMillis(recordedUri ? 0 : recorderState.durationMillis)}</Text>
            <Text style={styles.hint}>
              {recording ? "Recording…" : recordedUri ? "Preview your clip" : `Up to ${MAX_AUDIO_RECORDING_SECONDS / 60} minutes`}
            </Text>
          </View>

          {recordedUri ? <Preview uri={recordedUri} /> : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button variant="tertiary" onPress={onClose} disabled={saving}>
              Cancel
            </Button>
            {recording ? (
              <Button onPress={() => void stopRecording()}>Stop</Button>
            ) : recordedUri ? (
              <>
                <Button variant="secondary" onPress={() => void startRecording()} disabled={saving}>
                  Record again
                </Button>
                <Button onPress={() => void useRecording()} disabled={saving}>
                  {saving ? "Adding…" : "Use recording"}
                </Button>
              </>
            ) : (
              <Button onPress={() => void startRecording()}>Start recording</Button>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    sheet: {
      width: "100%",
      maxWidth: 440,
      gap: 16,
      padding: 20,
      borderRadius: radius.xl,
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: { fontSize: 16, fontWeight: "600", color: colors.fgPrimary },
    timerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.fgError },
    timer: { fontSize: 22, fontWeight: "600", color: colors.fgPrimary, fontVariant: ["tabular-nums"] },
    hint: { fontSize: 13, color: colors.fgTertiary },
    error: { fontSize: 13, color: colors.fgError },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" },
  });
}
