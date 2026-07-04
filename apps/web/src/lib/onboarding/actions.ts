"use server";

import { mergeGenerationSettingsPatch } from "@deephaus/shared";
import { formatAuthNetworkError } from "@/lib/auth-errors";
import { createTextSource, runGenerationJob } from "@/lib/jobs/run-generation";
import type { OnboardingDeckResult, OnboardingPreferences } from "@/lib/onboarding/types";
import { createClient } from "@/lib/supabase/server";

type ActionResult<T = void> = { error?: string; ok?: boolean; data?: T };

const GOAL_DECK_LABEL: Record<OnboardingPreferences["goal"], string> = {
  exam: "Exam Prep",
  lang: "Language",
  school: "School Notes",
  cert: "Certification",
  hobby: "Hobby",
  curious: "Getting Started",
};

export async function completeOnboardingAction(
  preferences: OnboardingPreferences,
): Promise<ActionResult> {
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.updateUser({
      data: {
        onboarding_completed: true,
        onboarding: {
          ...preferences,
          completed_at: new Date().toISOString(),
        },
      },
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}

export async function generateOnboardingDeckAction(
  preferences: OnboardingPreferences,
  sourceText: string,
): Promise<ActionResult<OnboardingDeckResult>> {
  const trimmed = sourceText.trim();
  if (!trimmed) return { error: "Paste some text to generate a deck." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const deckLabel = GOAL_DECK_LABEL[preferences.goal] ?? "Starter";
  const deckName = `${deckLabel} — Starter`;

  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        name: deckName,
        deck_name: deckName,
        settings: { cardMix: "both", density: 5, dailyGoal: preferences.daily },
      })
      .select("id, deck_name")
      .single();

    if (projectError || !project) {
      return { error: projectError?.message ?? "Could not create deck." };
    }

    const source = await createTextSource(supabase, project.id, trimmed);
    const { job, cards } = await runGenerationJob(
      supabase,
      source.id,
      mergeGenerationSettingsPatch({ cardMix: "both", detailLevel: "medium" }),
    );

    if (job.status === "failed") {
      return { error: job.error ?? "Generation failed." };
    }

    const first = cards[0];
    if (!first) return { error: "No cards were generated. Try pasting more text." };

    return {
      ok: true,
      data: {
        projectId: project.id,
        deckName: project.deck_name ?? deckName,
        cardCount: cards.length,
        firstCard: {
          id: first.id,
          type: first.type,
          front: first.front,
          back: first.back,
          clozeText: first.cloze_text,
        },
      },
    };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}
