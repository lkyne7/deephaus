"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type UniversityOption = {
  id: string;
  name: string;
  country: string;
  domains: string[];
};

type Props = {
  initialName: string;
  initialUsername: string;
  universityName: string | null;
  universityEmail: string | null;
  universityVerifiedAt: string | null;
};

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error ?? "Something went wrong";
}

export function ProfileDisplayNameForm({
  initialName,
  initialUsername,
  universityName,
  universityEmail,
  universityVerifiedAt,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [username, setUsername] = useState(initialUsername);
  const [profileBusy, setProfileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [schoolEmail, setSchoolEmail] = useState(universityEmail ?? "");
  const [pendingUniversity, setPendingUniversity] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verified, setVerified] = useState(Boolean(universityVerifiedAt));
  const [currentUniversityName, setCurrentUniversityName] = useState(universityName);
  const [universityQuery, setUniversityQuery] = useState(universityName ?? "");
  const [selectedUniversityId, setSelectedUniversityId] = useState<string | null>(null);
  const [universityResults, setUniversityResults] = useState<UniversityOption[]>([]);
  const [universitySearchBusy, setUniversitySearchBusy] = useState(false);

  useEffect(() => {
    const query = universityQuery.trim();
    if (query.length < 2 || query === currentUniversityName) {
      setUniversityResults([]);
      setUniversitySearchBusy(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setUniversitySearchBusy(true);
      try {
        const response = await fetch(
          `/api/profile/universities?q=${encodeURIComponent(query)}&limit=8`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = await response.json();
        setUniversityResults(Array.isArray(body.universities) ? body.universities : []);
      } catch (searchError) {
        if (
          !(searchError instanceof DOMException && searchError.name === "AbortError") &&
          !controller.signal.aborted
        ) {
          setUniversityResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setUniversitySearchBusy(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [currentUniversityName, universityQuery]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, username }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setProfileBusy(false);
    }
  }

  async function sendCode() {
    setVerificationBusy(true);
    setVerificationError(null);
    setCode("");
    try {
      const response = await fetch("/api/profile/university-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: schoolEmail,
          university_id: selectedUniversityId ?? undefined,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      setPendingUniversity(body.university_name);
      setCurrentUniversityName(body.university_name);
      setUniversityQuery(body.university_name);
      setSelectedUniversityId(body.university_id ?? null);
      setVerified(false);
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
      setVerified(true);
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

  async function selectUniversity(university: UniversityOption) {
    setUniversitySearchBusy(true);
    setVerificationError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ university_id: university.id }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const profile = await response.json();
      setSelectedUniversityId(university.id);
      setCurrentUniversityName(profile.university_name ?? university.name);
      setUniversityQuery(profile.university_name ?? university.name);
      setUniversityResults([]);
      setSchoolEmail("");
      setPendingUniversity(null);
      setVerified(false);
      router.refresh();
    } catch (selectionError) {
      setVerificationError(
        selectionError instanceof Error
          ? selectionError.message
          : "Failed to update university",
      );
    } finally {
      setUniversitySearchBusy(false);
    }
  }

  const dirty =
    name.trim() !== initialName.trim() || username.trim().toLowerCase() !== initialUsername;

  return (
    <div style={s.root}>
      <form onSubmit={save} style={s.form}>
        <div className="field" style={s.field}>
          <label className="field-label" htmlFor="full-name">
            Full name
          </label>
          <input
            id="full-name"
            type="text"
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="Your name"
            autoComplete="name"
            maxLength={80}
            required
          />
        </div>
        <div className="field" style={s.field}>
          <label className="field-label" htmlFor="username">
            Username
          </label>
          <div style={s.usernameInput}>
            <span style={s.at}>@</span>
            <input
              id="username"
              type="text"
              className="input"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                setSaved(false);
              }}
              placeholder="username"
              autoComplete="username"
              minLength={3}
              maxLength={30}
              pattern="[a-z0-9_]+"
              required
              style={{ paddingLeft: 28 }}
            />
          </div>
          <span style={s.hint}>Shown publicly on the leaderboard.</span>
        </div>
        <button
          type="submit"
          className="btn btn-secondary btn-sm"
          disabled={profileBusy || !dirty}
        >
          {profileBusy ? "Saving…" : saved && !dirty ? "Saved" : "Save profile"}
        </button>
        {error ? <p style={s.error}>{error}</p> : null}
      </form>

      <div style={s.university}>
        <div style={s.universityHead}>
          <div>
            <div style={s.universityTitle}>University</div>
            <p style={s.hint}>
              Confirm your affiliation with an email from a recognized institution.
            </p>
          </div>
          {verified && currentUniversityName ? (
            <span style={s.verifiedBadge}>
              <i className="ri-verified-badge-fill" aria-hidden />
              Verified
            </span>
          ) : null}
        </div>
        <div className="field" style={s.universitySearch}>
          <label className="field-label" htmlFor="university-search">
            University
          </label>
          <input
            id="university-search"
            type="search"
            className="input"
            value={universityQuery}
            onChange={(event) => {
              setUniversityQuery(event.target.value);
              setSelectedUniversityId(null);
            }}
            placeholder="Search by university name or domain"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={universityResults.length > 0}
            aria-controls="university-results"
          />
          {universitySearchBusy ? <span style={s.searchStatus}>Searching…</span> : null}
          {universityResults.length > 0 ? (
            <div id="university-results" role="listbox" style={s.searchResults}>
              {universityResults.map((university) => (
                <button
                  key={university.id}
                  type="button"
                  role="option"
                  aria-selected={university.id === selectedUniversityId}
                  style={s.searchOption}
                  onClick={() => void selectUniversity(university)}
                >
                  <span style={s.searchOptionName}>{university.name}</span>
                  <span style={s.searchOptionMeta}>
                    {university.country} · {university.domains[0]}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <span style={s.hint}>
            Selecting a university does not verify affiliation. Verification requires the email
            code below.
          </span>
        </div>
        {currentUniversityName ? (
          <div style={s.schoolName}>
            {currentUniversityName}
            {!verified ? <span style={s.unverifiedText}> · Unverified</span> : null}
          </div>
        ) : null}
        <div style={s.verifyRow}>
          <div className="field" style={s.field}>
            <label className="field-label" htmlFor="university-email">
              University email
            </label>
            <input
              id="university-email"
              type="email"
              className="input"
              value={schoolEmail}
              onChange={(e) => {
                setSchoolEmail(e.target.value);
                if (e.target.value.trim().toLowerCase() !== universityEmail?.toLowerCase()) {
                  setVerified(false);
                }
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
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--border-1)",
  },
  form: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
  },
  field: { flex: 1, minWidth: 220 },
  usernameInput: { position: "relative" },
  at: {
    position: "absolute",
    zIndex: 1,
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    color: "var(--fg-quaternary)",
    font: "500 14px/1 var(--font-sans)",
  },
  hint: {
    display: "block",
    margin: "4px 0 0",
    color: "var(--fg-quaternary)",
    font: "400 12px/17px var(--font-sans)",
  },
  university: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingTop: 20,
    borderTop: "1px solid var(--border-1)",
  },
  universityHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  universityTitle: {
    color: "var(--fg-primary)",
    font: "600 15px/20px var(--font-sans)",
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
  },
  schoolName: {
    color: "var(--fg-primary)",
    font: "600 14px/20px var(--font-sans)",
  },
  unverifiedText: {
    color: "var(--fg-quaternary)",
    fontWeight: 500,
  },
  universitySearch: {
    position: "relative",
    maxWidth: 680,
  },
  searchStatus: {
    position: "absolute",
    right: 12,
    top: 34,
    color: "var(--fg-quaternary)",
    font: "400 12px/16px var(--font-sans)",
  },
  searchResults: {
    position: "absolute",
    zIndex: 20,
    top: 64,
    left: 0,
    right: 0,
    display: "flex",
    flexDirection: "column",
    maxHeight: 280,
    overflowY: "auto",
    border: "1px solid var(--border-1)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.14)",
  },
  searchOption: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    padding: "10px 12px",
    border: 0,
    borderBottom: "1px solid var(--border-1)",
    background: "transparent",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  searchOptionName: {
    color: "var(--fg-primary)",
    font: "500 13px/18px var(--font-sans)",
  },
  searchOptionMeta: {
    color: "var(--fg-quaternary)",
    font: "400 12px/16px var(--font-sans)",
  },
  verifyRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    flexWrap: "wrap",
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
