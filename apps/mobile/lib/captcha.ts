import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "@/lib/config";

/**
 * Supabase Auth checks a Cloudflare Turnstile token when sending an email code,
 * on password sign-in and on password resets once CAPTCHA protection is on.
 * Apple and Google sign-in use ID tokens, which Supabase doesn't check.
 *
 * The sign-in screens mount <CaptchaPrefetch>, a hidden web view on the
 * website's /captcha?embed=1 page, so a token is usually ready before the
 * person taps Continue. If Cloudflare wants a visible check, or the hidden
 * view can't produce a token in time, the page opens in a browser sheet and
 * the token comes back through the app's scheme.
 *
 * Off unless the build sets EXPO_PUBLIC_TURNSTILE_ENABLED=1, which must match
 * the website having a Turnstile site key.
 */
export const captchaEnabled = process.env.EXPO_PUBLIC_TURNSTILE_ENABLED === "1";
export const CAPTCHA_EMBED_URL = `${API_BASE_URL}/captcha?embed=1`;

/** Turnstile tokens last 300 seconds; drop them a little earlier. */
const TOKEN_LIFETIME_MS = 280_000;
const HIDDEN_WAIT_MS = 8_000;

export class CaptchaCanceledError extends Error {
  constructor() {
    super("The security check was canceled.");
  }
}

type Waiter = (token: string | null) => void;

/** Shared between the hidden web view and whoever needs a token. */
const prefetch = {
  mounted: 0,
  token: null as { value: string; at: number } | null,
  /** Cloudflare asked for a visible check; the hidden view can't finish. */
  interactive: false,
  waiters: [] as Waiter[],
  /** Asks the mounted web view for a fresh token (tokens are single use). */
  reload: null as (() => void) | null,
};

export function registerCaptchaPrefetch(reload: () => void): () => void {
  prefetch.mounted += 1;
  prefetch.reload = reload;
  return () => {
    prefetch.mounted -= 1;
    if (prefetch.mounted === 0) {
      prefetch.reload = null;
      prefetch.token = null;
      prefetch.interactive = false;
      for (const waiter of prefetch.waiters.splice(0)) waiter(null);
    }
  };
}

/** Called by the hidden web view. */
export function reportCaptchaEvent(event: { type: "token"; token: string } | { type: "expired" | "interactive" | "error" }) {
  if (event.type === "token") {
    prefetch.interactive = false;
    const waiter = prefetch.waiters.shift();
    if (waiter) {
      waiter(event.token);
      prefetch.reload?.();
    } else {
      prefetch.token = { value: event.token, at: Date.now() };
    }
    return;
  }
  prefetch.token = null;
  if (event.type === "interactive") {
    prefetch.interactive = true;
    for (const waiter of prefetch.waiters.splice(0)) waiter(null);
  }
}

function takePrefetchedToken(): Promise<string | null> {
  if (prefetch.mounted === 0 || prefetch.interactive) return Promise.resolve(null);
  const stored = prefetch.token;
  prefetch.token = null;
  if (stored && Date.now() - stored.at < TOKEN_LIFETIME_MS) {
    prefetch.reload?.();
    return Promise.resolve(stored.value);
  }
  return new Promise((resolve) => {
    let done = false;
    const waiter: Waiter = (token) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => {
      prefetch.waiters = prefetch.waiters.filter((w) => w !== waiter);
      waiter(null);
    }, HIDDEN_WAIT_MS);
    prefetch.waiters.push(waiter);
  });
}

async function tokenFromBrowserSheet(): Promise<string> {
  const returnTo = Linking.createURL("captcha");
  const url = `${API_BASE_URL}/captcha?return=${encodeURIComponent(returnTo)}`;
  const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
  if (result.type !== "success" || !result.url) throw new CaptchaCanceledError();
  const token = Linking.parse(result.url).queryParams?.token;
  if (typeof token !== "string" || !token) throw new Error("The security check did not complete.");
  return token;
}

/** A single-use token, or undefined when CAPTCHA protection is off. */
export async function getCaptchaToken(): Promise<string | undefined> {
  if (!captchaEnabled) return undefined;
  const hidden = await takePrefetchedToken();
  if (hidden) return hidden;
  return tokenFromBrowserSheet();
}
