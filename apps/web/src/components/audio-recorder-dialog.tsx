"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the finished recording; the dialog closes afterwards. */
  onRecorded: (file: File) => void | Promise<void>;
};

/** Recordings stop here; a card clip is a word, a phrase or a short sound. */
const MAX_SECONDS = 5 * 60;

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

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Record a clip from the microphone, preview it, and hand it back as a File. */
export function AudioRecorderDialog({ open, onClose, onRecorded }: Props) {
  const [status, setStatus] = useState<"idle" | "recording" | "recorded" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const meterRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    if (meterRef.current != null) window.cancelAnimationFrame(meterRef.current);
    timerRef.current = null;
    meterRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevel(0);
  }, []);

  const reset = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    stopTracks();
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setStatus("idle");
    setSeconds(0);
    setError(null);
  }, [preview, stopTracks]);

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => stopTracks(), [stopTracks]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    const type = pickRecordingType();
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      setError("Recording isn't supported in this browser. Upload an audio file instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Allow the microphone for this site and try again.");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, type.mimeType ? { mimeType: type.mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || type.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
      stopTracks();
      if (blob.size === 0) {
        setError("Nothing was recorded.");
        setStatus("idle");
        return;
      }
      const file = new File([blob], `recording-${Date.now()}.${type.ext}`, { type: blob.type });
      setPreview({ url: URL.createObjectURL(blob), file });
      setStatus("recorded");
    };
    recorder.start();
    setStatus("recording");
    setSeconds(0);

    const started = Date.now();
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stopRecording();
    }, 250);

    // A simple input level meter so the user can see the mic is live.
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        setLevel(peak);
        meterRef.current = window.requestAnimationFrame(tick);
      };
      meterRef.current = window.requestAnimationFrame(tick);
    } catch {
      // The meter is cosmetic.
    }
  }, [stopRecording, stopTracks]);

  const acceptRecording = useCallback(async () => {
    if (!preview) return;
    setStatus("saving");
    try {
      await onRecorded(preview.file);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the recording.");
      setStatus("recorded");
    }
  }, [onClose, onRecorded, preview]);

  if (!open) return null;

  return (
    <div style={s.overlay} role="presentation" onClick={status === "saving" ? undefined : onClose}>
      <div
        style={s.card}
        role="dialog"
        aria-modal="true"
        aria-label="Record audio"
        onClick={(event) => event.stopPropagation()}
      >
        <div style={s.header}>
          <i className="ri-mic-line" aria-hidden style={{ fontSize: 20, color: "var(--ink-500)" }} />
          <h2 style={s.title}>Record audio</h2>
        </div>

        <div style={s.body}>
          <div style={s.timerRow}>
            <span style={{ ...s.dot, opacity: status === "recording" ? 1 : 0.25 }} aria-hidden />
            <span style={s.timer}>{formatSeconds(seconds)}</span>
            <span style={s.hint}>
              {status === "recording" ? "Recording…" : status === "recorded" ? "Preview your clip" : `Up to ${MAX_SECONDS / 60} minutes`}
            </span>
          </div>
          <div style={s.meterTrack} aria-hidden>
            <div style={{ ...s.meterFill, width: `${Math.min(100, Math.round(level * 140))}%` }} />
          </div>
          {preview ? <audio controls src={preview.url} style={{ width: "100%" }} /> : null}
          {error ? <div className="notice notice-error">{error}</div> : null}
        </div>

        <div style={s.actions}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={status === "saving"}>
            Cancel
          </button>
          {status === "idle" ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void startRecording()}>
              <i className="ri-record-circle-line" aria-hidden /> Start recording
            </button>
          ) : status === "recording" ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={stopRecording}>
              <i className="ri-stop-circle-line" aria-hidden /> Stop
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={status === "saving"}>
                Record again
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void acceptRecording()} disabled={status === "saving"}>
                {status === "saving" ? "Adding…" : "Use recording"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 120,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    boxShadow: "var(--shadow-xl)",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: { display: "flex", alignItems: "center", gap: 10 },
  title: { margin: 0, font: "600 16px/1.3 var(--font-sans)", color: "var(--ink-900)" },
  body: { display: "flex", flexDirection: "column", gap: 12 },
  timerRow: { display: "flex", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: "50%", background: "var(--grade-again)" },
  timer: { font: "600 20px/1 var(--font-mono, monospace)", color: "var(--ink-900)", fontVariantNumeric: "tabular-nums" },
  hint: { font: "400 13px/1.3 var(--font-sans)", color: "var(--ink-500)" },
  meterTrack: { height: 6, borderRadius: 3, background: "var(--border-2)", overflow: "hidden" },
  meterFill: { height: "100%", background: "var(--teal-500)", transition: "width 80ms linear" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
};
