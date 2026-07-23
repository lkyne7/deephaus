import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { isOnboardingCompleted } from "@/lib/onboarding/metadata";
import { getAuthUser } from "@/lib/data/server-auth";

export default async function OnboardingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (isOnboardingCompleted(user)) redirect("/dashboard");

  return <OnboardingFlow />;
}
