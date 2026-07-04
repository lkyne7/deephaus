import { notFound } from "next/navigation";
import { DEMO_ONBOARDING_DECK, OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { ONBOARDING_STEPS } from "@/lib/onboarding/types";

type Props = {
  searchParams: Promise<{ step?: string }>;
};

/** Dev-only visual preview of the guided onboarding flow (no auth required). */
export default async function OnboardingPreviewPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();

  const { step } = await searchParams;
  const stepIndex = step ? ONBOARDING_STEPS.indexOf(step as (typeof ONBOARDING_STEPS)[number]) : 0;
  const initialStep = stepIndex >= 0 ? stepIndex : 0;
  const demoDeck =
    initialStep >= ONBOARDING_STEPS.indexOf("firstcard") ? DEMO_ONBOARDING_DECK : undefined;

  return <OnboardingFlow initialStep={initialStep} demoDeck={demoDeck} previewMode />;
}
