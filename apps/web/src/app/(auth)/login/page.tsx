import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { isOnboardingCompleted } from "@/lib/onboarding/metadata";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(isOnboardingCompleted(user) ? "/dashboard" : "/onboarding");
  }
  return <AuthForm mode="login" />;
}
