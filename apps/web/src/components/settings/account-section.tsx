"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  SettingsLoadingState,
  type SettingsAccount,
  type SettingsProfile,
} from "@/components/settings/settings-overlay";
import {
  teardownPowerSync,
  waitForPowerSyncUploads,
} from "@/lib/offline/db";

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error ?? "Something went wrong";
}

type Props = {
  account: SettingsAccount;
  profile: SettingsProfile | null;
  onProfileUpdated: (profile: SettingsProfile) => void;
  onClose: () => void;
};

export function AccountSection({ account, profile, onProfileUpdated, onClose }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [signingOut, setSigningOut] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Profile arrives async after the overlay opens; sync the form once loaded.
  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name);
    setUsername(profile.username);
  }, [profile]);

  if (!profile) {
    return <SettingsLoadingState label="Loading your account…" />;
  }

  const dirty =
    name.trim() !== profile.full_name.trim() ||
    username.trim().toLowerCase() !== profile.username;

  async function saveProfile(e: React.FormEvent) {
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
      const updated = (await response.json()) as SettingsProfile;
      onProfileUpdated({ ...profile!, ...updated });
      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setProfileBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { avatar_url: string };
      onProfileUpdated({ ...profile!, avatar_url: body.avatar_url });
      router.refresh();
    } catch (uploadError) {
      setAvatarError(
        uploadError instanceof Error ? uploadError.message : "Failed to upload picture",
      );
    } finally {
      setAvatarBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      onProfileUpdated({ ...profile!, avatar_url: null });
      router.refresh();
    } catch (removeError) {
      setAvatarError(
        removeError instanceof Error ? removeError.message : "Failed to remove picture",
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    const uploadsFinished = await waitForPowerSyncUploads();
    if (
      !uploadsFinished &&
      !window.confirm(
        "Your offline changes could not finish syncing. Sign out anyway and discard those unsynced changes?",
      )
    ) {
      setSigningOut(false);
      return;
    }

    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setSigningOut(false);
      return;
    }
    await teardownPowerSync();
    onClose();
    window.location.href = "/login";
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const uploadsFinished = await waitForPowerSyncUploads();
      if (
        !uploadsFinished &&
        !window.confirm(
          "Some offline changes have not synced. Deleting your account will permanently discard them. Continue?",
        )
      ) {
        setDeleting(false);
        return;
      }

      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acknowledge_subscription_cancellation: true }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      // The auth user no longer exists; clear the local session and leave.
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => undefined);
      await teardownPowerSync().catch(() => undefined);
      window.location.href = "/";
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error ? deleteFailure.message : "Failed to delete account",
      );
      setDeleting(false);
    }
  }

  return (
    <div style={s.root}>
      {/* Profile picture */}
      <section style={s.block}>
        <div style={s.blockTitle}>Profile picture</div>
        <div style={s.avatarRow}>
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="Profile picture" style={s.avatarImg} />
          ) : (
            <div style={s.avatarFallback}>{account.initials}</div>
          )}
          <div style={s.avatarActions}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              <i className={avatarBusy ? "ri-loader-4-line icon-spin" : "ri-upload-2-line"} aria-hidden />
              {profile.avatar_url ? "Change photo" : "Upload photo"}
            </button>
            {profile.avatar_url ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void removeAvatar()}
                disabled={avatarBusy}
              >
                Remove
              </button>
            ) : null}
            <span style={s.hint}>JPEG, PNG, WebP, or GIF. Max 5 MB.</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />
        </div>
        {avatarError ? <p style={s.error}>{avatarError}</p> : null}
      </section>

      {/* Name + username */}
      <section style={s.block}>
        <div style={s.blockTitle}>Profile</div>
        <form onSubmit={saveProfile} style={s.form}>
          <div className="field" style={s.field}>
            <label className="field-label" htmlFor="settings-full-name">
              Full name
            </label>
            <input
              id="settings-full-name"
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
            <label className="field-label" htmlFor="settings-username">
              Username
            </label>
            <div style={s.usernameInput}>
              <span style={s.at}>@</span>
              <input
                id="settings-username"
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
            style={s.saveButton}
            disabled={profileBusy || !dirty}
          >
            {profileBusy ? "Saving…" : saved && !dirty ? "Saved" : "Save profile"}
          </button>
          {error ? <p style={s.error}>{error}</p> : null}
        </form>
      </section>

      {/* Login details */}
      <section style={s.block}>
        <div style={s.blockTitle}>Login</div>
        <div style={s.loginRow}>
          <div style={s.loginText}>
            <span style={s.loginEmail}>{account.email}</span>
            <span style={s.hint}>Member since {account.memberSince}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            <i className="ri-logout-box-r-line" aria-hidden />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section style={{ ...s.block, ...s.dangerBlock }}>
        <div style={{ ...s.blockTitle, color: "var(--grade-again)" }}>Danger zone</div>
        <div style={s.dangerRow}>
          <div style={{ minWidth: 0 }}>
            <div style={s.dangerTitle}>Delete account</div>
            <p style={s.dangerCopy}>
              Permanently delete your account, decks, cards, review history, and uploaded files.
              This cannot be undone. App Store, Google Play, and Stripe subscriptions must be
              cancelled separately or they may continue renewing.
            </p>
          </div>
          {!deleteConfirming ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                setDeleteConfirming(true);
                setDeleteText("");
                setDeleteError(null);
              }}
            >
              Delete account
            </button>
          ) : null}
        </div>
        {deleteConfirming ? (
          <div style={s.dangerConfirm}>
            <p style={s.dangerCopy}>
              Type <strong>{account.email}</strong> to confirm.
            </p>
            <div style={s.dangerConfirmRow}>
              <input
                type="text"
                className="input"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder={account.email}
                autoComplete="off"
                spellCheck={false}
                style={{ maxWidth: 320 }}
              />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={deleting || deleteText.trim().toLowerCase() !== account.email.toLowerCase()}
                onClick={() => void handleDeleteAccount()}
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeleteConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
            {deleteError ? <p style={s.error}>{deleteError}</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 24,
    borderBottom: "1px solid var(--border-secondary)",
  },
  blockTitle: {
    font: "600 15px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  avatarRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  avatarImg: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    objectFit: "cover",
    border: "1px solid var(--border-secondary)",
    flexShrink: 0,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "var(--brand-500)",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 22px/1 var(--font-sans)",
    flexShrink: 0,
  },
  avatarActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  form: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 12,
  },
  saveButton: {
    marginTop: 26,
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
  loginRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  loginText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  loginEmail: {
    font: "500 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  dangerBlock: {
    border: "1px solid var(--grade-again-border, #fecaca)",
    borderRadius: 8,
    padding: 16,
    background: "var(--grade-again-bg, #fef2f2)",
  },
  dangerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  dangerTitle: {
    font: "600 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  dangerCopy: {
    margin: "4px 0 0",
    font: "400 13px/19px var(--font-sans)",
    color: "var(--fg-tertiary)",
    maxWidth: 480,
  },
  dangerConfirm: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingTop: 8,
    borderTop: "1px solid var(--grade-again-border, #fecaca)",
  },
  dangerConfirmRow: {
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
