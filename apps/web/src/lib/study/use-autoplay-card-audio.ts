"use client";

import { extractCardAudioUrls, localMediaUri } from "@deephaus/shared";
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

/** Play a list of clips one after another; resolves when the last one ends or the player is stopped. */
class ClipQueue {
  private current: HTMLAudioElement | null = null;
  private stopped = false;

  async play(urls: string[]): Promise<void> {
    for (const url of urls) {
      if (this.stopped) return;
      await new Promise<void>((resolve) => {
        const audio = new Audio(localMediaUri(url) ?? url);
        this.current = audio;
        audio.preload = "auto";
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        // Browsers may refuse to auto-play before any user gesture; that is fine.
        audio.play().catch(() => resolve());
      });
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.current) {
      this.current.pause();
      this.current.src = "";
      this.current = null;
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
    if (!enabled || urls.length === 0) return;
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
