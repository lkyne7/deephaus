"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  return createClient();
}

export function AuthPanel() {
  const router = useRouter();
  const supabase = getSupabase();

  async function signIn(email: string) {
    if (!supabase) {
      alert("Configure Supabase env vars in apps/web/.env.local");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/projects` },
    });
    if (error) alert(error.message);
    else alert("Check your email for the magic link.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const email = new FormData(form).get("email") as string;
        void signIn(email);
      }}
    >
      <label className="label" htmlFor="email">
        Email for magic link sign-in
      </label>
      <input
        id="email"
        className="input"
        type="email"
        name="email"
        placeholder="you@example.com"
        required
      />
      <div className="row">
        <button className="btn btn-primary" type="submit">
          Send magic link
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </form>
  );
}

export function NavBar() {
  return (
    <header className="header container">
      <Link href="/" className="logo">
        Sluggo
      </Link>
      <nav className="row">
        <Link href="/projects">Projects</Link>
      </nav>
    </header>
  );
}
