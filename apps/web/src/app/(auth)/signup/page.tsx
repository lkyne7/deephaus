import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/auth-next";
import { isOnboardingCompleted } from "@/lib/onboarding/metadata";
import { createClient } from "@/lib/supabase/server";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(safeNext ?? (isOnboardingCompleted(user) ? "/dashboard" : "/onboarding"));
  }
  return <AuthForm mode="signup" next={safeNext ?? undefined} />;
}
