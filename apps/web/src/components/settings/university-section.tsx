"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SettingsLoadingState, type SettingsProfile } from "@/components/settings/settings-shell";

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error ?? "Something went wrong";
}

type Props = {
  profile: SettingsProfile | null;
  onProfileUpdated: (profile: SettingsProfile) => void;
};

export function UniversitySection({ profile, onProfileUpdated }: Props) {
  const router = useRouter();

  const [schoolEmail, setSchoolEmail] = useState("");
  const [pendingUniversity, setPendingUniversity] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const universityName = profile?.university_name ?? null;
  const verified = Boolean(profile?.university_email_verified_at);

  // Seed inputs once the profile loads.
  useEffect(() => {
    if (!profile) return;
    setSchoolEmail(profile.university_email ?? "");
  }, [profile]);

  if (!profile) {
    return <SettingsLoadingState label="Loading university details…" />;
  }

  async function sendCode() {
    setVerificationBusy(true);
    setVerificationError(null);
    setCode("");
    try {
      const response = await fetch("/api/profile/university-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: schoolEmail }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      setPendingUniversity(body.university_name);
    } catch (sendError) {
      setVerificationError(
        sendError instanceof Error ? sendError.message : "Failed to send verification code",
      );
    } finally {
      setVerificationBusy(false);
    }
  }

  async function verifyCode() {
    setVerificationBusy(true);
    setVerificationError(null);
    try {
      const response = await fetch("/api/profile/university-email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: schoolEmail, code }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      onProfileUpdated({
        ...profile!,
        university_name: pendingUniversity ?? profile!.university_name,
        university_email: schoolEmail.trim().toLowerCase(),
        university_email_verified_at: new Date().toISOString(),
      });
      setPendingUniversity(null);
      setCode("");
      router.refresh();
    } catch (verifyError) {
      setVerificationError(
        verifyError instanceof Error ? verifyError.message : "Failed to verify email",
      );
    } finally {
      setVerificationBusy(false);
    }
  }

  async function removeUniversity() {
    const confirmed = window.confirm(
      verified
        ? "Remove your university verification? You can re-verify at any time with your university email."
        : "Remove your university affiliation?",
    );
    if (!confirmed) return;

    setRemoveBusy(true);
    setVerificationError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ university_id: null }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const updated = (await response.json()) as SettingsProfile;
      onProfileUpdated({ ...profile!, ...updated });
      setSchoolEmail("");
      setPendingUniversity(null);
      setCode("");
      router.refresh();
    } catch (removeError) {
      setVerificationError(
        removeError instanceof Error ? removeError.message : "Failed to remove university",
      );
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <section className="dhs-sec">
      <div className="dhs-sec-head">
        <h2>University</h2>
        {verified && universityName ? (
          <span className="dh-pill dh-pill--accent">
            <i className="ri-verified-badge-fill" aria-hidden />
            Verified
          </span>
        ) : null}
      </div>
      <p className="dhs-lede">
        Confirm your affiliation with an email from a recognized institution. Verified status
        appears next to your username.
      </p>

      {universityName ? (
        <div className="dhs-row">
          <div className="dhs-row__main">
            <div className="dhs-row__title">{universityName}</div>
            {!verified ? <div className="dhs-muted">Unverified</div> : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void removeUniversity()}
            disabled={removeBusy}
          >
            {removeBusy ? "Removing…" : verified ? "Remove verification" : "Remove"}
          </button>
        </div>
      ) : null}

      <div className="dhs-field-action">
        <div className="field">
          <label className="field-label" htmlFor="settings-university-email">
            University email
          </label>
          <input
            id="settings-university-email"
            type="email"
            className="input"
            value={schoolEmail}
            onChange={(e) => {
              setSchoolEmail(e.target.value);
              setPendingUniversity(null);
            }}
            placeholder="you@university.edu"
            autoComplete="email"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={verificationBusy || !schoolEmail.trim()}
          onClick={() => void sendCode()}
        >
          {verificationBusy ? "Sending…" : verified ? "Verify another" : "Send code"}
        </button>
      </div>

      {pendingUniversity ? (
        <div className="dhs-confirm">
          <p>
            We recognized <strong>{pendingUniversity}</strong>. Enter the six-digit code sent to{" "}
            <strong>{schoolEmail.trim().toLowerCase()}</strong>.
          </p>
          <div className="dhs-inline">
            <input
              className="input dhs-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="University verification code"
              placeholder="000000"
              maxLength={6}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={verificationBusy || code.length !== 6}
              onClick={() => void verifyCode()}
            >
              {verificationBusy ? "Verifying…" : "Verify university"}
            </button>
          </div>
        </div>
      ) : null}
      {verificationError ? <p className="dhs-error">{verificationError}</p> : null}
    </section>
  );
}
