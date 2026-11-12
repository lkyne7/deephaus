import {
  friendlyEmailCodeError,
  isCompleteEmailCode,
  newAccountMetadata,
  normalizeEmailCode,
  recordTermsAcceptance,
} from "@deephaus/shared";
import type { User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { getCaptchaToken } from "@/lib/captcha";
import { supabase } from "@/lib/config";

/**
 * Email sign-in by 6-digit code. New addresses get an account (continuing past
 * the consent line is the terms agreement). The email also carries a link back
 * to this app for people who prefer tapping it on the same phone.
 */
export async function sendEmailCode(email: string): Promise<string | null> {
  const address = email.trim();
  if (!address) return "Enter your email.";
  let captchaToken: string | undefined;
  try {
    captchaToken = await getCaptchaToken();
  } catch (error) {
    return error instanceof Error ? error.message : "The security check did not complete.";
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: Linking.createURL("auth/callback"),
      data: newAccountMetadata(),
      ...(captchaToken ? { captchaToken } : {}),
    },
  });
  return error ? friendlyEmailCodeError(error.message) : null;
}

export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ error: string } | { user: User | null }> {
  const token = normalizeEmailCode(code);
  if (!isCompleteEmailCode(token)) return { error: "Enter the code from the email." };
  const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
  if (error) return { error: friendlyEmailCodeError(error.message) };
  await recordTermsAcceptance(supabase, data.user);
  return { user: data.user };
}
