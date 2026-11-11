import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "@/lib/config";

/**
 * Supabase Auth checks a Cloudflare Turnstile token on password sign-in,
 * sign-up, magic links and password resets once CAPTCHA protection is on.
 * The phone has no web view of its own, so it opens the website's /captcha
 * page in a browser sheet (like Google and Apple sign-in) and reads the token
 * from the redirect back to this app's scheme. Off unless the build sets
 * EXPO_PUBLIC_TURNSTILE_ENABLED=1, which must match the website having a
 * Turnstile site key.
 */
export const captchaEnabled = process.env.EXPO_PUBLIC_TURNSTILE_ENABLED === "1";

export class CaptchaCanceledError extends Error {
  constructor() {
    super("The security check was canceled.");
  }
}

/** A single-use token, or undefined when CAPTCHA protection is off. */
export async function getCaptchaToken(): Promise<string | undefined> {
  if (!captchaEnabled) return undefined;
  const returnTo = Linking.createURL("captcha");
  const url = `${API_BASE_URL}/captcha?return=${encodeURIComponent(returnTo)}`;
  const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
  if (result.type !== "success" || !result.url) throw new CaptchaCanceledError();
  const token = Linking.parse(result.url).queryParams?.token;
  if (typeof token !== "string" || !token) throw new Error("The security check did not complete.");
  return token;
}
