import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { MAX_VOICE_PROMPT_SECONDS, cardAudioSizeError } from "@deephaus/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";

export type VoicePromptStatus = "idle" | "recording" | "transcribing";

const MAX_MILLIS = MAX_VOICE_PROMPT_SECONDS * 1000;

function formatMillis(millis: number): string {
  const total = Math.floor(millis / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Add dictated text after whatever is already typed. */
export function appendTranscript(current: string, transcript: string): string {
  const head = current.replace(/\s+$/, "");
  return head ? `${head} ${transcript}` : transcript;
}

/**
 * Record a spoken prompt, send it for transcription, and hand back the text.
 * `toggle` starts a recording, or stops one and transcribes it. Recording stops
 * on its own at MAX_VOICE_PROMPT_SECONDS.
 */
export function useVoicePrompt(onTranscript: (text: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const mounted = useRef(true);

  const recording = recorderState.isRecording;
  const status: VoicePromptStatus = transcribing ? "transcribing" : recording ? "recording" : "idle";

  const resetAudioMode = useCallback(() => {
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const stop = useCallback(async () => {
    try {
      await recorder.stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop recording.");
      return;
    } finally {
      resetAudioMode();
    }
    haptics.light();
    const uri = recorder.uri;
    if (!uri) {
      setError("Nothing was recorded.");
      return;
    }
    setTranscribing(true);
    try {
      const blob = await (await fetch(uri)).blob();
      const sizeError = cardAudioSizeError(blob.size);
      if (sizeError) throw new Error("That recording is too long. Keep voice prompts under two minutes.");
      const { text } = await api.transcribeVoicePrompt(blob, "voice-prompt.m4a");
      if (mounted.current && text) onTranscriptRef.current(text);
    } catch (err) {
      if (mounted.current) {
        haptics.error();
        setError(err instanceof Error ? err.message : "Could not transcribe the recording. Try again.");
      }
    } finally {
      if (mounted.current) setTranscribing(false);
    }
  }, [recorder, resetAudioMode]);

  const start = useCallback(async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Allow microphone access in Settings to speak your prompt.");
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      haptics.medium();
    } catch (err) {
      resetAudioMode();
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  }, [recorder, resetAudioMode]);

  useEffect(() => {
    if (recording && recorderState.durationMillis >= MAX_MILLIS) void stop();
  }, [recording, recorderState.durationMillis, stop]);

  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  // Leaving the screen mid-recording drops the clip and frees the microphone.
  // useAudioRecorder releases its native recorder in its own cleanup, which
  // runs before this one, so reading `recorder.isRecording` here throws
  // "Unable to find the native shared object" and takes the screen down with
  // it (sending a prompt unmounts the composer). Use the last state we saw.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recordingRef.current) {
        try {
          void recorder.stop().catch(() => undefined);
        } catch {
          // Already released, which stops the recording too.
        }
      }
      resetAudioMode();
    };
  }, [recorder, resetAudioMode]);

  const toggle = useCallback(() => {
    if (transcribing) return;
    if (recording) void stop();
    else void start();
  }, [recording, start, stop, transcribing]);

  /** One line for the composer to show while voice input is busy or failed. */
  const statusText =
    status === "recording"
      ? `Listening… ${formatMillis(recorderState.durationMillis)}`
      : status === "transcribing"
        ? "Transcribing…"
        : error;

  return {
    status,
    error,
    statusText,
    clearError: useCallback(() => setError(null), []),
    toggle,
  };
}
