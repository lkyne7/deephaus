"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
import { signInAction, signUpAction } from "@/lib/auth-actions";
import { BrandMark } from "@/components/brand-mark";
import { FadeIn } from "@/components/motion/fade-in";
import { ThemeToggle } from "@/components/theme-provider";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState<"google" | "apple" | null>(null);

  async function signInWithProvider(provider: "google" | "apple") {
    setSocialBusy(provider);
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? "/dashboard")}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (oauthError) setError(oauthError.message);
    } catch {
      setError(`Could not continue with ${provider === "google" ? "Google" : "Apple"}.`);
    } finally {
      setSocialBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result =
        mode === "signup"
          ? await signUpAction(email, password, window.location.origin, name)
          : await signInAction(email, password);

      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.notice) {
        setNotice(result.notice);
        return;
      }
      if (result?.ok) {
        posthog.capture(mode === "signup" ? "user_signed_up" : "user_signed_in", {
          method: "password",
        });
        router.push(next ?? (mode === "signup" ? "/onboarding" : "/dashboard"));
        router.refresh();
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? "Welcome back" : "Create your account";
  const sub = mode === "login" ? "Sign in to keep studying." : "Get started in seconds.";
  const cta = mode === "login" ? "Sign in" : "Create account";
  const altText = mode === "login" ? "Don't have an account?" : "Already have an account?";
  const altCta = mode === "login" ? "Create one" : "Sign in";
  const altBase = mode === "login" ? "/signup" : "/login";
  const altHref = next ? `${altBase}?next=${encodeURIComponent(next)}` : altBase;

  return (
    <div style={s.page}>
      <div style={s.themeSwitcher}>
        <ThemeToggle />
      </div>
      <FadeIn style={s.card}>
        <Link href="/" style={s.brand} className="dh-eq dh-eq-hover">
          <BrandMark size={28} />
          <span className="dh-wordmark">DeepHaus</span>
        </Link>

        <div style={{ marginTop: 8 }}>
          <h1
            style={{
              font: "600 28px/36px var(--font-sans)",
              color: "var(--fg-primary)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h1>
          <p
            style={{
              color: "var(--fg-tertiary)",
              margin: "6px 0 0",
              font: "400 14px/22px var(--font-sans)",
            }}
          >
            {sub}
          </p>
        </div>

        {error && <div className="notice notice-error">{error}</div>}
        {notice && <div className="notice notice-info">{notice}</div>}

        <div style={s.socialButtons}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || socialBusy !== null}
            onClick={() => void signInWithProvider("google")}
            style={s.socialButton}
          >
            <i className="ri-google-fill" aria-hidden />
            {socialBusy === "google" ? "Connecting…" : "Continue with Google"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || socialBusy !== null}
            onClick={() => void signInWithProvider("apple")}
            style={s.socialButton}
          >
            <i className="ri-apple-fill" aria-hidden />
            {socialBusy === "apple" ? "Connecting…" : "Continue with Apple"}
          </button>
        </div>

        <div style={s.divider}>
          <span style={s.dividerLine} />
          <span>or continue with email</span>
          <span style={s.dividerLine} />
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "signup" ? (
            <div className="field">
              <label className="field-label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
                maxLength={80}
              />
            </div>
          ) : null}
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
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 6 characters" : "Enter your password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={6}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
            {busy ? "Please wait…" : cta}
          </button>
        </form>

        <div
          style={{
            textAlign: "center",
            color: "var(--fg-quaternary)",
            font: "400 13px/18px var(--font-sans)",
          }}
        >
          {altText}{" "}
          <Link href={altHref} style={{ color: "var(--fg-brand)", fontWeight: 500 }}>
            {altCta}
          </Link>
        </div>
      </FadeIn>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "var(--bg-canvas)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    position: "relative",
  },
  themeSwitcher: {
    position: "absolute",
    top: 20,
    right: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 12,
    padding: 32,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: "var(--shadow-sm)",
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    font: "600 18px/1 var(--font-sans)",
    color: "var(--fg-primary)",
  },
  socialButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  socialButton: {
    width: "100%",
    justifyContent: "center",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "var(--fg-quaternary)",
    font: "400 12px/16px var(--font-sans)",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "var(--border-1)",
  },
};
