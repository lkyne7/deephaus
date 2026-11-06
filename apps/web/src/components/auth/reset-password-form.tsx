"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { updatePasswordAction } from "@/lib/auth-actions";
import { MIN_NEW_PASSWORD_LENGTH } from "@/lib/auth-recovery";

export function ResetPasswordForm({ recovering, linkFailed }: { recovering: boolean; linkFailed: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_NEW_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_NEW_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await updatePasswordAction(password);
      if (result.error) {
        setError(result.error);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Could not update your password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!recovering) {
    return (
      <AuthLayout
        title="Choose a new password"
        subtitle={
          linkFailed
            ? "This link has expired, was already used, or was opened in a different browser."
            : "Open a new password reset link from your email to continue."
        }
      >
        <Link href="/forgot-password" className="btn btn-primary dh-auth__wide">
          Request a new link
        </Link>
        <p className="dh-auth__alt">
          <Link href="/login">Back to sign in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll stay signed in on this device.">
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="dh-auth__fields">
        <div className="field">
          <label className="field-label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_NEW_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            minLength={MIN_NEW_PASSWORD_LENGTH}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <button type="submit" className="btn btn-primary dh-auth__wide" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthLayout>
  );
}
