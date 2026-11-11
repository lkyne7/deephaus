"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { desktopScheme, getDesktopBridge } from "@deephaus/shared";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Turnstile, turnstileEnabled, type TurnstileHandle } from "@/components/auth/turnstile";
import { recoveryRedirectUrl } from "@/lib/auth-recovery";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The PKCE verifier lives in this browser, so desktop has to get the
      // link back through its own scheme, the same way OAuth does.
      const desktop = getDesktopBridge();
      const callbackUrl = desktop
        ? `${desktopScheme(desktop.variant)}://auth/callback`
        : `${window.location.origin}/auth/callback`;
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: recoveryRedirectUrl(callbackUrl),
        ...(captchaToken ? { captchaToken } : {}),
      });
      turnstile.current?.reset();
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSentTo(email.trim());
    } catch {
      setError("Could not send the reset link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`If ${sentTo} has an account, a reset link is on its way. Open it in this browser.`}
      >
        <button type="button" className="btn btn-secondary dh-auth__wide" onClick={() => setSentTo(null)}>
          Use a different email
        </button>
        <p className="dh-auth__alt">
          <Link href="/login">Back to sign in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {error && <div className="notice notice-error">{error}</div>}
      <form onSubmit={submit} className="dh-auth__fields">
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
            autoComplete="email"
            required
            autoFocus
          />
        </div>
        <Turnstile
          ref={turnstile}
          onToken={setCaptchaToken}
          onError={() => setError("The security check could not load. Refresh the page and try again.")}
        />
        <button
          type="submit"
          className="btn btn-primary dh-auth__wide"
          disabled={busy || (turnstileEnabled && !captchaToken)}
        >
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="dh-auth__alt">
        Remembered it? <Link href="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
