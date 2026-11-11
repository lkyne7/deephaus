"use client";

import { formatVoiceSeconds, type VoicePromptStatus } from "@/lib/voice/use-voice-prompt";

type Props = {
  status: VoicePromptStatus;
  seconds: number;
  onToggle: () => void;
  /** The composer's own button class, so the mic matches its neighbours. */
  className: string;
  disabled?: boolean;
};

/** Mic for a prompt box: tap to talk, tap again to turn the speech into text. */
export function VoicePromptButton({ status, seconds, onToggle, className, disabled }: Props) {
  const recording = status === "recording";
  const transcribing = status === "transcribing";
  const label = recording ? "Stop recording" : transcribing ? "Transcribing…" : "Speak your prompt";
  return (
    <button
      type="button"
      className={`${className} dh-voice-btn${recording ? " is-recording" : ""}`}
      aria-label={label}
      aria-pressed={recording}
      title={label}
      disabled={disabled || transcribing}
      onClick={onToggle}
    >
      {transcribing ? (
        <i className="ri-loader-4-line icon-spin" aria-hidden />
      ) : recording ? (
        <>
          <span className="dh-voice-btn__dot" aria-hidden />
          <span className="dh-voice-btn__time" aria-live="off">
            {formatVoiceSeconds(seconds)}
          </span>
          <i className="ri-stop-fill" aria-hidden />
        </>
      ) : (
        <i className="ri-mic-line" aria-hidden />
      )}
    </button>
  );
}
