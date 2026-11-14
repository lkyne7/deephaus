"use server";

import { cookies } from "next/headers";
import { formatAuthNetworkError } from "@/lib/auth-errors";
import { MIN_NEW_PASSWORD_LENGTH, RECOVERY_COOKIE } from "@/lib/auth-recovery";
import { createClient } from "@/lib/supabase/server";
import { captureFirstSignIn } from "@/lib/posthog-server";
import {
  friendlyEmailCodeError,
  isCompleteEmailCode,
  newAccountMetadata,
  normalizeEmailCode,
  recordTermsAcceptance,
} from "@deephaus/shared";

type AuthActionResult = { error?: string; notice?: string; ok?: boolean };

export async function signInAction(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<AuthActionResult> {
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}

/**
 * Emails a sign-in code (and a fallback link). New addresses get an account;
 * the consent line under the button is the terms agreement, recorded here.
 */
export async function sendEmailCodeAction(
  email: string,
  origin: string,
  next?: string,
  captchaToken?: string,
): Promise<AuthActionResult> {
  const address = email.trim();
  if (!address) return { error: "Enter your email." };
  const supabase = await createClient();
  const callback = `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: callback,
        data: newAccountMetadata(),
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    if (error) return { error: friendlyEmailCodeError(error.message) };
    return { ok: true };
  } catch (err) {
    return { error: formatAuthNetworkError(err) };
  }
}

export async function verifyEmailCodeAction(email: string, code: string): Promise<AuthActionResult> {
  const token = normalizeEmailCode(code);
  if (!isCompleteEmailCode(token)) return { error: "Enter the code from the email." };
  const supabase = await createClient();

  try {
    const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    if (error) return { error: friendlyEmailCodeError(error.message) };
    await captureFirstSignIn(data.user);
    await recordTermsAcceptance(supabase, data.user);
    return { ok: true };
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
