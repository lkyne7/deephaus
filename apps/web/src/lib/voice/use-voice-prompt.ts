"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_PROMPT_SECONDS } from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";

export type VoicePromptStatus = "idle" | "recording" | "transcribing";

/** Speech needs far less than music; this keeps two minutes near 0.5 MB. */
const RECORDING_BITS_PER_SECOND = 32_000;

/** The first container the browser can record; Chrome and Firefox give webm, Safari mp4. */
function pickRecordingType(): { mimeType: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Array<[string, string]> = [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "m4a"],
    ["audio/ogg;codecs=opus", "ogg"],
  ];
  for (const [mimeType, ext] of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, ext };
  }
  return { mimeType: "", ext: "webm" };
}

/** Whether this browser can record from the microphone at all. */
export function voicePromptSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/**
 * Record a spoken prompt, send it for transcription, and hand back the text.
 * `toggle` starts a recording, or stops one and transcribes it. Recording stops
 * on its own at MAX_VOICE_PROMPT_SECONDS.
 */
export function useVoicePrompt(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<VoicePromptStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Decided after mount so the server render and the first client render match.
  useEffect(() => setSupported(voicePromptSupported()), []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // Leaving the page mid-recording drops the clip and frees the microphone.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMic();
    },
    [releaseMic],
  );

  const transcribe = useCallback(async (blob: Blob, ext: string) => {
    setStatus("transcribing");
    try {
      const form = new FormData();
      form.append("file", new File([blob], `voice-prompt.${ext}`, { type: blob.type }));
      const response = await apiFetch("/api/voice/transcribe", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok || !body.text) {
        throw new Error(body.error ?? "Could not transcribe the recording. Try again.");
      }
      onTranscriptRef.current(body.text);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Voice input needs a connection."
          : err instanceof Error
            ? err.message
            : "Could not transcribe the recording. Try again.",
      );
    } finally {
      setStatus("idle");
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const type = pickRecordingType();
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Allow the microphone for this site and try again.");
      return;
    }
    cancelledRef.current = false;
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, {
      ...(type.mimeType ? { mimeType: type.mimeType } : {}),
      audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
    });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      releaseMic();
      recorderRef.current = null;
      if (cancelledRef.current) return;
      const mimeType = (recorder.mimeType || type.mimeType || "audio/webm").split(";")[0];
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (blob.size === 0) {
        setError("Nothing was recorded.");
        setStatus("idle");
        return;
      }
      void transcribe(blob, type.ext);
    };
    recorder.start();
    setSeconds(0);
    setStatus("recording");

    const started = Date.now();
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_VOICE_PROMPT_SECONDS) stop();
    }, 250);
  }, [releaseMic, stop, transcribe]);

  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status === "idle") void start();
  }, [start, status, stop]);

  /** Stop and throw the recording away. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
    releaseMic();
    setStatus("idle");
  }, [releaseMic, stop]);

  return { status, seconds, error, clearError: () => setError(null), supported, toggle, cancel };
}

/** Add dictated text after whatever is already typed. */
export function appendTranscript(current: string, transcript: string): string {
  const head = current.replace(/\s+$/, "");
  return head ? `${head} ${transcript}` : transcript;
}

export function formatVoiceSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
