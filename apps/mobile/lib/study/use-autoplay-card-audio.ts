import { extractCardAudioUrls, localMediaUri } from "@deephaus/shared";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useEffect, useMemo, useRef } from "react";

type Options = {
  /** Changes when the learner moves to another card; stops playback and starts the question side. */
  cardKey: string | null;
  /** Fields shown before the answer is revealed (front, or cloze text). */
  questionFields: Array<string | null | undefined>;
  /** Fields shown on reveal (back and extra). */
  answerFields: Array<string | null | undefined>;
  revealed: boolean;
  enabled: boolean;
};

let audioModeReady: Promise<void> | null = null;
/** Clips should be audible with the ringer switch on silent, like any media app. */
function ensureAudioMode(): Promise<void> {
  if (!audioModeReady) {
    audioModeReady = setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }
  return audioModeReady;
}

/** Play a list of clips one after another; stops early when `stop()` is called. */
class ClipQueue {
  private player: AudioPlayer | null = null;
  private stopped = false;

  async play(urls: string[]): Promise<void> {
    await ensureAudioMode();
    for (const url of urls) {
      if (this.stopped) return;
      await new Promise<void>((resolve) => {
        const player = createAudioPlayer({ uri: localMediaUri(url) ?? url });
        this.player = player;
        const subscription = player.addListener("playbackStatusUpdate", (status) => {
          if (status.didJustFinish) {
            subscription.remove();
            player.remove();
            if (this.player === player) this.player = null;
            resolve();
          }
        });
        try {
          player.play();
        } catch {
          subscription.remove();
          player.remove();
          resolve();
        }
      });
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.player) {
      try {
        this.player.pause();
        this.player.remove();
      } catch {
        // Already released.
      }
      this.player = null;
    }
  }
}

/**
 * Anki-style audio: when a card appears its question-side clips play; when the
 * answer is revealed its answer-side clips play. Nothing plays when disabled,
 * and a card change stops whatever is still playing.
 */
export function useAutoplayCardAudio({ cardKey, questionFields, answerFields, revealed, enabled }: Options): void {
  const questionUrls = useMemo(() => extractCardAudioUrls(...questionFields), [questionFields]);
  const answerUrls = useMemo(() => extractCardAudioUrls(...answerFields), [answerFields]);
  const queueRef = useRef<ClipQueue | null>(null);

  const start = (urls: string[]) => {
    queueRef.current?.stop();
    if (!enabled || !cardKey || urls.length === 0) return;
    const queue = new ClipQueue();
    queueRef.current = queue;
    void queue.play(urls);
  };

  // New card: play the question side.
  useEffect(() => {
    start(questionUrls);
    return () => queueRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, enabled]);

  // Reveal: play the answer side (once per card).
  useEffect(() => {
    if (revealed) start(answerUrls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, cardKey]);
}
