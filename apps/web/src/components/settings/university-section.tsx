"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  SettingsLoadingState,
  type SettingsProfile,
} from "@/components/settings/settings-overlay";

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
    <div style={s.root}>
      <div style={s.head}>
        <p style={s.lede}>
          Confirm your affiliation with an email from a recognized institution. Verified status
          appears alongside your username.
        </p>
        {verified && universityName ? (
          <span style={s.verifiedBadge}>
            <i className="ri-verified-badge-fill" aria-hidden />
            Verified
          </span>
        ) : null}
      </div>

      {universityName ? (
        <div style={s.currentRow}>
          <div style={s.schoolName}>
            {universityName}
            {!verified ? <span style={s.unverifiedText}> · Unverified</span> : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void removeUniversity()}
            disabled={removeBusy}
          >
            <i className="ri-close-circle-line" aria-hidden />
            {removeBusy ? "Removing…" : verified ? "Remove verification" : "Remove"}
          </button>
        </div>
      ) : null}

      <div style={s.verifyRow}>
        <div className="field" style={s.field}>
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
          className="btn btn-secondary btn-sm"
          disabled={verificationBusy || !schoolEmail.trim()}
          onClick={() => void sendCode()}
        >
          {verificationBusy ? "Sending…" : verified ? "Verify another" : "Send code"}
        </button>
      </div>

      {pendingUniversity ? (
        <div style={s.codePanel}>
          <p style={s.codeHint}>
            We recognized <strong>{pendingUniversity}</strong>. Enter the six-digit code sent to{" "}
            <strong>{schoolEmail.trim().toLowerCase()}</strong>.
          </p>
          <div style={s.codeRow}>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="University verification code"
              placeholder="000000"
              maxLength={6}
              style={{ maxWidth: 160, letterSpacing: "0.18em" }}
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
      {verificationError ? <p style={s.error}>{verificationError}</p> : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  lede: {
    margin: 0,
    font: "400 14px/21px var(--font-sans)",
    color: "var(--fg-tertiary)",
    maxWidth: 520,
  },
  verifiedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    padding: "5px 10px",
    background: "var(--brand-50)",
    color: "var(--brand-700)",
    font: "600 12px/1 var(--font-sans)",
    flexShrink: 0,
  },
  currentRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    padding: "10px 12px",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    background: "var(--bg-surface-2)",
  },
  schoolName: {
    color: "var(--fg-primary)",
    font: "600 14px/20px var(--font-sans)",
  },
  unverifiedText: {
    color: "var(--fg-quaternary)",
    fontWeight: 500,
  },
  verifyRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    flexWrap: "wrap",
  },
  field: { flex: 1, minWidth: 220, maxWidth: 400 },
  hint: {
    display: "block",
    margin: "4px 0 0",
    color: "var(--fg-quaternary)",
    font: "400 12px/17px var(--font-sans)",
  },
  codePanel: {
    border: "1px solid var(--border-1)",
    borderRadius: 8,
    padding: 14,
    background: "var(--bg-surface-2)",
  },
  codeHint: {
    margin: "0 0 10px",
    color: "var(--fg-secondary)",
    font: "400 13px/18px var(--font-sans)",
  },
  codeRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  error: {
    width: "100%",
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
