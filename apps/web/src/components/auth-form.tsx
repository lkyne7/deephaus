"use client";

import { EMAIL_CODE_MAX_LENGTH, EMAIL_CODE_RESEND_SECONDS, isCompleteEmailCode, normalizeEmailCode } from "@deephaus/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";
import { sendEmailCodeAction, signInAction, verifyEmailCodeAction } from "@/lib/auth-actions";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Turnstile, turnstileEnabled, type TurnstileHandle } from "@/components/auth/turnstile";
import { CAPTCHA_WIDGET_FAILED, friendlyAuthError } from "@/lib/captcha-errors";
import { createClient } from "@/lib/supabase/client";
import { desktopScheme, getDesktopBridge } from "@deephaus/shared";

type Mode = "login" | "signup";
type Step = "email" | "code";

/**
 * One form for signing in and creating an account: Apple, Google, or an email
 * code (new addresses get an account). A password stays available for people
 * who set one. The consent line under the buttons is the terms agreement.
 */
export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [usePassword, setUsePassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState<"google" | "apple" | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Supabase checks a Turnstile token when sending a code and on password
  // sign-in once CAPTCHA protection is on; verifying a code needs none.
  // Tokens are single use, so reset after each try. If the widget fails, the
  // button stays usable and Supabase decides (see captcha-errors).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const needsCaptcha = turnstileEnabled && !captchaToken && !captchaFailed;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function onCaptchaToken(token: string | null) {
    setCaptchaToken(token);
    if (token) {
      setCaptchaFailed(false);
      setError((current) => (current === CAPTCHA_WIDGET_FAILED ? null : current));
    }
  }

  function finish(method: string) {
    posthog.capture("user_signed_in", { method });
    // The app layout sends accounts that haven't finished onboarding there.
    router.push(next ?? "/dashboard");
    router.refresh();
  }

  async function signInWithProvider(provider: "google" | "apple") {
    setSocialBusy(provider);
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const desktop = getDesktopBridge();
      // Google rejects sign-in inside embedded web views, so the desktop app
      // finishes OAuth in the system browser and returns on its own scheme.
      // The shell then loads /auth/callback?code=… so the PKCE verifier cookie
      // stored by this page completes the exchange.
      const redirectTo = desktop
        ? `${desktopScheme(desktop.variant)}://auth/callback?next=${encodeURIComponent(next ?? "/dashboard")}`
        : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? "/dashboard")}`;
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: desktop !== null },
      });
      if (oauthError) {
        setError(oauthError.message);
      } else if (desktop && data?.url) {
        await desktop.openExternal(data.url);
        setNotice("Finish signing in using your browser, then return to DeepHaus.");
      }
    } catch {
      setError(`Could not continue with ${provider === "google" ? "Google" : "Apple"}.`);
    } finally {
      setSocialBusy(null);
    }
  }

  async function sendCode() {
    const result = await sendEmailCodeAction(email, window.location.origin, next, captchaToken ?? undefined);
    turnstile.current?.reset();
    if (result.error) {
      setError(friendlyAuthError(result.error));
      return false;
    }
    setResendIn(EMAIL_CODE_RESEND_SECONDS);
    return true;
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (usePassword) {
        const result = await signInAction(email, password, captchaToken ?? undefined);
        turnstile.current?.reset();
        if (result.error) setError(friendlyAuthError(result.error));
        else finish("password");
        return;
      }
      if (await sendCode()) {
        setCode("");
        setStep("code");
      }
    } catch {
      turnstile.current?.reset();
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isCompleteEmailCode(code) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyEmailCodeAction(email, code);
      if (result.error) setError(result.error);
      else finish("email_code");
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || resendIn > 0) return;
    setBusy(true);
    setError(null);
    try {
      if (await sendCode()) setNotice("We sent a new code.");
    } finally {
      setBusy(false);
    }
  }

  const title = step === "code" ? "Check your email" : mode === "login" ? "Welcome back" : "Create your account";
  const sub =
    step === "code"
      ? `Enter the code we sent to ${email.trim()}.`
      : mode === "login"
        ? "Sign in to keep studying."
        : "Get started in seconds.";
  const altText = mode === "login" ? "Don't have an account?" : "Already have an account?";
  const altCta = mode === "login" ? "Create one" : "Sign in";
  const altBase = mode === "login" ? "/signup" : "/login";
  const altHref = next ? `${altBase}?next=${encodeURIComponent(next)}` : altBase;
  const legal = (
    <p className="dh-auth__legal">
      By continuing, you confirm you&apos;re 13 or older and agree to the <Link href="/terms">Terms</Link> and{" "}
      <Link href="/privacy">Privacy Policy</Link>.
    </p>
  );
  // Rendered in both steps: a resend needs a fresh token.
  const widget = (
    <Turnstile
      ref={turnstile}
      onToken={onCaptchaToken}
      onError={() => {
        setCaptchaFailed(true);
        setError(CAPTCHA_WIDGET_FAILED);
      }}
    />
  );

  if (step === "code") {
    return (
      <AuthLayout title={title} subtitle={sub}>
        {error && <div className="notice notice-error">{error}</div>}
        {notice && <div className="notice notice-info">{notice}</div>}
        <form onSubmit={submitCode} className="dh-auth__fields">
          <div className="field">
            <label className="field-label" htmlFor="code">
              Code
            </label>
            <input
              id="code"
              className="input dh-auth__code"
              value={code}
              onChange={(e) => setCode(normalizeEmailCode(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code from the email"
              maxLength={EMAIL_CODE_MAX_LENGTH}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn btn-primary dh-auth__wide" disabled={busy || !isCompleteEmailCode(code)}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
        <p className="dh-auth__alt">
          {resendIn > 0 ? (
            <>You can send a new code in {resendIn}s.</>
          ) : (
            <button type="button" className="dh-auth__link" onClick={() => void resend()} disabled={busy || needsCaptcha}>
              Send a new code
            </button>
          )}
          {" · "}
          <button
            type="button"
            className="dh-auth__link"
            onClick={() => {
              setStep("email");
              setError(null);
              setNotice(null);
            }}
          >
            Use a different email
          </button>
        </p>
        <p className="dh-auth__legal">The email also has a link you can open on this device instead.</p>
        {widget}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle={sub}>
      {error && <div className="notice notice-error">{error}</div>}
      {notice && <div className="notice notice-info">{notice}</div>}

      <button
        type="button"
        className="btn btn-secondary dh-auth__wide"
        disabled={busy || socialBusy !== null}
        onClick={() => void signInWithProvider("apple")}
      >
        <i className="ri-apple-fill" aria-hidden />
        {socialBusy === "apple" ? "Connecting…" : "Continue with Apple"}
      </button>
      <button
        type="button"
        className="btn btn-secondary dh-auth__wide"
        disabled={busy || socialBusy !== null}
        onClick={() => void signInWithProvider("google")}
      >
        <i className="ri-google-fill" aria-hidden />
        {socialBusy === "google" ? "Connecting…" : "Continue with Google"}
      </button>

      <div className="dh-auth__or">or</div>

      <form onSubmit={submitEmail} className="dh-auth__fields">
        <div className="field">
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            autoComplete={usePassword ? "username" : "email"}
            required
          />
        </div>
        {usePassword ? (
          <div className="field">
            <div className="dh-auth__label-row">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <Link href="/forgot-password">Forgot?</Link>
            </div>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>
        ) : null}

        {widget}

        <button type="submit" className="btn btn-primary dh-auth__wide" disabled={busy || needsCaptcha}>
          {busy ? "Please wait…" : usePassword ? "Sign in" : "Continue with email"}
        </button>
        <button
          type="button"
          className="dh-auth__link"
          onClick={() => {
            setUsePassword((v) => !v);
            setError(null);
          }}
        >
          {usePassword ? "Email me a code instead" : "Use a password instead"}
        </button>
      </form>

      {legal}

      <p className="dh-auth__alt">
        {altText} <Link href={altHref}>{altCta}</Link>
      </p>
    </AuthLayout>
  );
}
