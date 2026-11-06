"use server";

import { cookies } from "next/headers";
import { formatAuthNetworkError } from "@/lib/auth-errors";
import { MIN_NEW_PASSWORD_LENGTH, RECOVERY_COOKIE } from "@/lib/auth-recovery";
import { createClient } from "@/lib/supabase/server";

type AuthActionResult = { error?: string; notice?: string; ok?: boolean };

export async function signInAction(email: string, password: string): Promise<AuthActionResult> {
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}

export async function signUpAction(
  email: string,
  password: string,
  origin: string,
  displayName: string,
): Promise<AuthActionResult> {
  const trimmedName = displayName.trim();
  if (!trimmedName) return { error: "Name is required." };
  if (trimmedName.length > 80) return { error: "Name must be 80 characters or fewer." };

  const supabase = await createClient();

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        data: { full_name: trimmedName, name: trimmedName },
      },
    });
    if (error) return { error: error.message };
    if (data.session) return { ok: true };
    return { notice: "Check your email to confirm your account, then sign in." };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}

export async function updatePasswordAction(password: string): Promise<AuthActionResult> {
  if (password.length < MIN_NEW_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_NEW_PASSWORD_LENGTH} characters.` };
  }

  const cookieStore = await cookies();
  if (!cookieStore.has(RECOVERY_COOKIE)) {
    return { error: "This reset link has expired. Request a new one." };
  }

  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    cookieStore.delete(RECOVERY_COOKIE);
    return { ok: true };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}
