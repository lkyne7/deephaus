"use client";

import {
  cardMediaDisplayUrlSized,
  extractCardMediaUrls,
  parseImageOcclusionData,
} from "@deephaus/shared";
import { useEffect, useRef } from "react";
import { preloadCardImage } from "@/lib/offline/media";

export interface StudyMediaCard {
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  occlusion_data?: unknown;
}

/** Cards ahead of the current one whose images are decoded in advance. */
export const STUDY_MEDIA_PRELOAD_AHEAD = 3;

/** Original (un-resized) image URLs a study card renders, deduplicated. */
export function studyCardImageSources(card: StudyMediaCard): string[] {
  const sources = new Set(extractCardMediaUrls(card.front, card.back, card.cloze_text, card.extra));
  const occlusionImage = card.occlusion_data ? parseImageOcclusionData(card.occlusion_data)?.imageUrl : null;
  if (occlusionImage) sources.add(occlusionImage);
  return [...sources];
}

/**
 * Decode the images of the current card and the next few before they are
 * shown, from the offline media cache when available, so moving to the next
 * card never waits on an image or swaps its source mid-animation. Loads stay
 * alive across card changes; they are only dropped once the window moves past
 * them or the reviewer unmounts.
 */
export function useStudyMediaPreload(queue: readonly StudyMediaCard[], index: number) {
  const loaders = useRef(new Map<string, HTMLImageElement | null>());

  useEffect(() => {
    const wanted = new Set<string>();
    const end = Math.min(queue.length, index + 1 + STUDY_MEDIA_PRELOAD_AHEAD);
    for (let i = Math.max(0, index); i < end; i += 1) {
      for (const original of studyCardImageSources(queue[i])) wanted.add(original);
    }
    for (const original of wanted) {
      if (!loaders.current.has(original)) {
        loaders.current.set(original, preloadCardImage(original, cardMediaDisplayUrlSized(original, "study")));
      }
    }
    for (const original of [...loaders.current.keys()]) {
      if (!wanted.has(original)) loaders.current.delete(original);
    }
  }, [queue, index]);

  useEffect(() => {
    const current = loaders.current;
    return () => current.clear();
  }, []);
}
