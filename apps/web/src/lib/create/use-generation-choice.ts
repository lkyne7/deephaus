"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FOCUS_PRESET, type GenerationCardType } from "@deephaus/shared";
import type { GenerationControls } from "@/components/create/card-settings-menu";
import { apiFetch } from "@/lib/api/fetch";
import { readJson } from "@/lib/background-tasks/api";
import {
  DEFAULT_GENERATION_CHOICE,
  choiceFromSettings,
  choiceSettingsPatch,
  readNewDeckChoice,
  writeNewDeckChoice,
  type GenerationChoice,
} from "@/lib/create/generation-choice";

/**
 * Card settings chosen outside Create, kept where Create reads them: a deck's
 * own saved settings, or this browser's choice for the next new deck. `flush`
 * waits for a deck's save, so Create opens on what was just picked.
 */
export function useGenerationChoice(deckId: string | null) {
  const [choice, setChoice] = useState<GenerationChoice>(DEFAULT_GENERATION_CHOICE);
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const saveRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!deckId) {
      setChoice(readNewDeckChoice(DEFAULT_FOCUS_PRESET) ?? DEFAULT_GENERATION_CHOICE);
      return;
    }
    let cancelled = false;
    void apiFetch(`/api/projects/${deckId}`, { credentials: "include" })
      .then((res) => readJson<{ settings?: unknown }>(res))
      .then((project) => {
        if (!cancelled) setChoice(choiceFromSettings(project.settings, DEFAULT_FOCUS_PRESET));
      })
      .catch(() => {
        // Create loads the deck's settings itself; the menu keeps the defaults.
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const update = useCallback(
    (patch: Partial<GenerationChoice>) => {
      const next = { ...choiceRef.current, ...patch };
      choiceRef.current = next;
      setChoice(next);
      if (!deckId) {
        writeNewDeckChoice(next);
        return;
      }
      saveRef.current = apiFetch(`/api/projects/${deckId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: choiceSettingsPatch(next) }),
      }).catch(() => {
        // Create still opens; it shows the deck's last saved settings.
      });
    },
    [deckId],
  );

  const selectedTypes = new Set<GenerationCardType>(choice.cardTypes);
  const controls: GenerationControls = {
    detailLevel: choice.detailLevel,
    onDetailLevelChange: (detailLevel) => update({ detailLevel }),
    qualityLevel: choice.qualityLevel,
    onQualityLevelChange: (qualityLevel) => update({ qualityLevel }),
    selectedTypes,
    onToggleCardType: (type) => {
      const next = new Set(selectedTypes);
      if (next.has(type)) {
        if (next.size === 1) return;
        next.delete(type);
      } else {
        next.add(type);
      }
      update({ cardTypes: [...next] as GenerationChoice["cardTypes"] });
    },
    focusPreset: choice.focusPreset,
    onFocusPresetChange: (focusPreset) => update({ focusPreset }),
    clozeHints: choice.clozeHints,
    onClozeHintsChange: (clozeHints) => update({ clozeHints }),
    autoTags: choice.autoTags,
    onAutoTagsChange: (autoTags) => update({ autoTags }),
  };

  const flush = useCallback(() => saveRef.current, []);

  return { controls, flush };
}
