"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { FadeIn } from "@/components/motion/fade-in";
import { ThemeToggle } from "@/components/theme-provider";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw new Error(error.message);
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        router.push("/dashboard");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? "Welcome Back" : "Create Your Account";
  const sub = mode === "login" ? "Sign in to keep studying." : "Get started in seconds.";
  const cta = mode === "login" ? "Sign In" : "Create Account";
  const altText = mode === "login" ? "Don't have an account?" : "Already have an account?";
  const altCta = mode === "login" ? "Create one" : "Sign in";
  const altHref = mode === "login" ? "/signup" : "/login";

  return (
    <div style={s.page}>
      <div style={s.themeSwitcher}>
        <ThemeToggle />
      </div>
      <FadeIn style={s.card}>
        <Link href="/" style={s.brand}>
          <BrandMark size={28} />
          <span>DeepHaus</span>
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

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
    borderRadius: 16,
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
};
