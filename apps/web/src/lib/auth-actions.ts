"use server";

import { formatAuthNetworkError } from "@/lib/auth-errors";
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
): Promise<AuthActionResult> {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) return { error: error.message };
    if (data.session) return { ok: true };
    return { notice: "Check your email to confirm your account, then sign in." };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}
