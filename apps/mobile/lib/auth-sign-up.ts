import { MIN_PASSWORD_LENGTH } from "@deephaus/shared";
import * as Linking from "expo-linking";
import { getCaptchaToken } from "@/lib/captcha";
import { supabase } from "@/lib/config";

export type SignUpResult = { error?: string; needsConfirmation?: boolean };

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
  agreedToTerms: boolean,
): Promise<SignUpResult> {
  if (agreedToTerms !== true) {
    return { error: "Confirm you're 13 or older and accept the Terms to create an account." };
  }
  const name = displayName.trim();
  if (!name) return { error: "Name is required." };
  if (name.length > 80) return { error: "Name must be 80 characters or fewer." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  let captchaToken: string | undefined;
  try {
    captchaToken = await getCaptchaToken();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The security check did not complete." };
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: Linking.createURL("auth/callback"),
      ...(captchaToken ? { captchaToken } : {}),
      data: { full_name: name, name, terms_accepted_at: new Date().toISOString() },
    },
  });
  return error ? { error: error.message } : { needsConfirmation: !data.session };
}
