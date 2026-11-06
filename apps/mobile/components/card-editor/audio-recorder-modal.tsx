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
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { NativeSheet } from "@/components/ui/native-sheet";
import type { ThemeColors } from "@/lib/theme";
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
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const finished = status.duration > 0 && status.currentTime >= status.duration - 0.05;
  return (
    <Button
      variant="secondary"
      size="lg"
      fullWidth
      leadingIcon={status.playing ? "pausePlayback" : "play"}
      label={`${status.playing ? "Playing preview…" : "Play preview"}${
        status.duration > 0 ? ` (${formatMillis(status.duration * 1000)})` : ""
      }`}
      accessibilityLabel={status.playing ? "Pause preview" : "Play preview"}
      onPress={() => {
        if (status.playing) return player.pause();
        if (finished) void player.seekTo(0);
        player.play();
      }}
    />
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
    <NativeSheet
      visible={visible}
      onClose={onClose}
      title="Record audio"
      detents={[{ height: 320 }, "large"]}
      dismissDisabled={saving}
    >
      <View style={styles.body}>
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
          {recording ? (
            <Button size="lg" label="Stop" style={styles.action} onPress={() => void stopRecording()} />
          ) : recordedUri ? (
            <>
              <Button
                variant="secondary"
                size="lg"
                label="Record again"
                style={styles.action}
                disabled={saving}
                onPress={() => void startRecording()}
              />
              <Button
                size="lg"
                label="Use recording"
                style={styles.action}
                loading={saving}
                onPress={() => void useRecording()}
              />
            </>
          ) : (
            <Button
              size="lg"
              label="Start recording"
              style={styles.action}
              onPress={() => void startRecording()}
            />
          )}
        </View>
      </View>
    </NativeSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
    timerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
    timer: {
      fontSize: 22,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
      fontVariant: ["tabular-nums"],
    },
    hint: { fontSize: 13, color: colors.fgTertiary },
    error: { fontSize: 13, color: colors.fgError },
    actions: { flexDirection: "row", gap: 8 },
    action: { flex: 1 },
  });
}
