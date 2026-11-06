"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SettingsAccount } from "@/components/settings/settings-context";
import { SettingsLoadingState, type SettingsProfile } from "@/components/settings/settings-shell";
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
};

export function AccountSection({ account, profile, onProfileUpdated }: Props) {
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

  // Profile arrives async; sync the form once loaded.
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
      if (response.status === 202) window.alert("Account deletion has started. We will finish removing your files in the background.");
      // Clear the local session while durable cleanup continues.
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
    <>
      <section className="dhs-sec">
        <h2>Profile</h2>
        <div className="dhs-avatar-row">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="Profile picture" className="dhs-avatar" />
          ) : (
            <div className="dhs-avatar">{account.initials}</div>
          )}
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
          <span className="dhs-hint">JPEG, PNG, WebP or GIF. Max 5 MB.</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />
        </div>
        {avatarError ? <p className="dhs-error">{avatarError}</p> : null}

        <form onSubmit={saveProfile}>
          <div className="dhs-grid2">
            <div className="field">
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
            <div className="field">
              <label className="field-label" htmlFor="settings-username">
                Username
              </label>
              <div className="dhs-prefixed">
                <span aria-hidden>@</span>
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
                />
              </div>
              <p className="dhs-help">Shown on the leaderboard.</p>
            </div>
          </div>
          {dirty || saved ? (
            <div className="dhs-form-foot">
              <button type="submit" className="btn btn-secondary btn-sm" disabled={profileBusy || !dirty}>
                {profileBusy ? "Saving…" : saved && !dirty ? "Saved" : "Save profile"}
              </button>
            </div>
          ) : null}
          {error ? <p className="dhs-error">{error}</p> : null}
        </form>
      </section>

      <section className="dhs-sec">
        <h2>Login</h2>
        <div className="dhs-row">
          <div className="dhs-row__main">
            <div>{account.email}</div>
            <div className="dhs-muted">Member since {account.memberSince}</div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>

      <section className="dhs-sec">
        <h2>Delete account</h2>
        <div className="dhs-row">
          <div className="dhs-row__main dhs-muted">
            Permanently deletes your decks, cards, review history and uploads. This can&apos;t be
            undone. App Store, Google Play and Stripe subscriptions must be cancelled separately.
          </div>
          {!deleteConfirming ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm dhs-danger-btn"
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
          <div className="dhs-confirm">
            <label htmlFor="settings-delete-confirm">
              Type <strong>{account.email}</strong> to confirm.
            </label>
            <div className="dhs-inline">
              <input
                id="settings-delete-confirm"
                type="text"
                className="input"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder={account.email}
                autoComplete="off"
                spellCheck={false}
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
            {deleteError ? <p className="dhs-error">{deleteError}</p> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
