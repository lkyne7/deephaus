import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { RECOVERY_COOKIE } from "@/lib/auth-recovery";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password · DeepHaus" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const cookieStore = await cookies();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <ResetPasswordForm
      recovering={Boolean(user) && cookieStore.has(RECOVERY_COOKIE)}
      linkFailed={error === "link"}
    />
  );
}
