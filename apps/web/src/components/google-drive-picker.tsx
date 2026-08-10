"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { ConnectionStatusSkeleton } from "@/components/ui/skeleton-patterns";

const SELECTABLE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

export type GoogleDriveFileSummary = {
  id: string;
  name: string;
  mimeType: string;
  url: string | null;
};

type DriveStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail?: string | null;
  accountName?: string | null;
};

type PickerToken = {
  accessToken: string;
  apiKey: string;
  appId: string;
};

type PickerDocument = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
};

type PickerResponse = {
  action?: string;
  docs?: PickerDocument[];
};

type GooglePickerNamespace = {
  Action: { PICKED: string };
  Feature: { NAV_HIDDEN: string };
  DocsView: new () => {
    setIncludeFolders(value: boolean): unknown;
    setSelectFolderEnabled(value: boolean): unknown;
    setMimeTypes(value: string): unknown;
  };
  PickerBuilder: new () => {
    addView(view: unknown): unknown;
    setOAuthToken(value: string): unknown;
    setDeveloperKey(value: string): unknown;
    setAppId(value: string): unknown;
    setOrigin(value: string): unknown;
    setSelectableMimeTypes(value: string): unknown;
    setCallback(value: (data: PickerResponse) => void): unknown;
    enableFeature(value: string): unknown;
    build(): { setVisible(value: boolean): void };
  };
};

declare global {
  interface Window {
    gapi?: { load(name: string, options: { callback: () => void; onerror: () => void }): void };
    google?: { picker: GooglePickerNamespace };
  }
}

let pickerScriptPromise: Promise<void> | null = null;

function loadPickerApi(): Promise<void> {
  if (window.google?.picker && window.gapi) return Promise.resolve();
  if (pickerScriptPromise) return pickerScriptPromise;
  pickerScriptPromise = new Promise<void>((resolve, reject) => {
    const loadModule = () => {
      if (!window.gapi) {
        reject(new Error("Google Picker failed to load."));
        return;
      }
      window.gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Google Picker failed to load.")),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-picker="true"]');
    if (existing) {
      existing.addEventListener("load", loadModule, { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Picker failed to load.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.dataset.googlePicker = "true";
    script.onload = loadModule;
    script.onerror = () => reject(new Error("Google Picker failed to load."));
    document.head.appendChild(script);
  });
  return pickerScriptPromise;
}

export function googleDriveConnectHref(returnTo: string): string {
  return `/api/google-drive/connect?returnTo=${encodeURIComponent(returnTo)}`;
}

export function GoogleDrivePicker({
  onSelect,
  selectedFile,
  returnTo,
  disabled,
}: {
  onSelect: (file: GoogleDriveFileSummary) => void;
  selectedFile?: GoogleDriveFileSummary | null;
  returnTo: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"picker" | "change" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectHref = useMemo(() => googleDriveConnectHref(returnTo), [returnTo]);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/google-drive/status");
      const data = (await res.json()) as DriveStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not check Google Drive.");
      setStatus(data);
    } catch {
      setStatus({ configured: false, connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openPicker = useCallback(async () => {
    setBusy("picker");
    setError(null);
    try {
      const [tokenRes] = await Promise.all([
        apiFetch("/api/google-drive/picker-token"),
        loadPickerApi(),
      ]);
      const token = (await tokenRes.json()) as PickerToken & { error?: string };
      if (!tokenRes.ok) throw new Error(token.error ?? "Could not authorize Google Picker.");
      const picker = window.google?.picker;
      if (!picker) throw new Error("Google Picker failed to load.");

      const view = new picker.DocsView();
      view.setIncludeFolders(true);
      view.setSelectFolderEnabled(false);
      view.setMimeTypes(SELECTABLE_MIME_TYPES);

      const builder = new picker.PickerBuilder();
      builder.addView(view);
      builder.setOAuthToken(token.accessToken);
      builder.setDeveloperKey(token.apiKey);
      builder.setAppId(token.appId);
      builder.setOrigin(window.location.origin);
      builder.setSelectableMimeTypes(SELECTABLE_MIME_TYPES);
      builder.enableFeature(picker.Feature.NAV_HIDDEN);
      builder.setCallback((data) => {
        if (data.action !== picker.Action.PICKED) return;
        const doc = data.docs?.[0];
        if (!doc?.id || !doc.name || !doc.mimeType) return;
        onSelect({
          id: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          url: doc.url ?? null,
        });
      });
      builder.build().setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Google Drive.");
    } finally {
      setBusy(null);
    }
  }, [onSelect]);

  const removeConnection = useCallback(async () => {
    const res = await apiFetch("/api/google-drive/connection", { method: "DELETE" });
    if (!res.ok) throw new Error("Could not disconnect Google Drive.");
  }, []);

  const changeAccount = useCallback(async () => {
    setBusy("change");
    setError(null);
    try {
      await removeConnection();
      window.location.href = connectHref;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch Google account.");
      setBusy(null);
    }
  }, [connectHref, removeConnection]);

  const disconnect = useCallback(async () => {
    const confirmed = window.confirm(
      "Disconnect Google Drive? Existing imported sources and flashcards will stay in DeepHaus.",
    );
    if (!confirmed) return;

    setBusy("disconnect");
    setError(null);
    try {
      await removeConnection();
      setStatus((current) => ({ ...(current ?? { configured: true }), connected: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Google Drive.");
    } finally {
      setBusy(null);
    }
  }, [removeConnection]);

  if (loading) {
    return <ConnectionStatusSkeleton />;
  }
  if (!status?.configured) {
    return (
      <div style={s.state}>
        <i className="ri-google-fill" style={s.stateIcon} aria-hidden />
        <strong>Google Drive isn&apos;t configured</strong>
        <span style={s.hint}>Add the Google OAuth, Picker API key, and project ID environment variables.</span>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div style={s.state}>
        <i className="ri-cloud-line" style={s.stateIcon} aria-hidden />
        <strong>Connect Google Drive</strong>
        <span style={s.hint}>DeepHaus can only access files you explicitly choose.</span>
        <a className="btn btn-primary btn-sm" href={connectHref}>
          Connect Google Drive
        </a>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.connection}>
        <div style={s.connectionMeta}>
          <i className="ri-google-fill" style={s.connectionIcon} aria-hidden />
          <div style={s.connectionText}>
            <span style={s.connectionLabel}>Connected account</span>
            <span style={s.connectionName}>
              {status.accountName ?? status.accountEmail ?? "Google Drive"}
            </span>
          </div>
        </div>
        <div style={s.connectionActions}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void changeAccount()}
            disabled={busy !== null}
          >
            {busy === "change" ? (
              <i className="ri-loader-4-line icon-spin" aria-hidden />
            ) : (
              <i className="ri-refresh-line" aria-hidden />
            )}
            Change account
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void disconnect()}
            disabled={busy !== null}
          >
            {busy === "disconnect" ? (
              <i className="ri-loader-4-line icon-spin" aria-hidden />
            ) : (
              <i className="ri-link-unlink-m" aria-hidden />
            )}
            Disconnect
          </button>
        </div>
      </div>
      <button
        type="button"
        style={s.pickButton}
        onClick={() => void openPicker()}
        disabled={disabled || busy !== null}
      >
        <i
          className={busy === "picker" ? "ri-loader-4-line icon-spin" : "ri-folder-open-line"}
          aria-hidden
        />
        <span>{selectedFile ? selectedFile.name : "Choose a file from Google Drive"}</span>
      </button>
      <span style={s.hint}>Google Docs, Slides, Sheets, PDF, Word, PowerPoint, or Excel.</span>
      {error ? <span style={s.error}>{error}</span> : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 10, minHeight: 0 },
  state: {
    flex: 1,
    minHeight: 180,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    textAlign: "center",
    color: "var(--fg-secondary)",
  },
  stateIcon: { fontSize: 28, color: "var(--ink-400)" },
  connection: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    background: "var(--paper-soft)",
  },
  connectionMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  connectionIcon: {
    width: 18,
    fontSize: 16,
    color: "var(--ink-500)",
    textAlign: "center",
    flexShrink: 0,
  },
  connectionText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  connectionLabel: {
    font: "500 10px/14px var(--font-sans)",
    color: "var(--ink-400)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  connectionName: {
    font: "600 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  connectionActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  pickButton: {
    flex: 1,
    minHeight: 130,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 18,
    border: "1px dashed var(--border-2)",
    borderRadius: 10,
    background: "var(--white)",
    color: "var(--fg-secondary)",
    font: "500 13px/18px var(--font-sans)",
    cursor: "pointer",
  },
  hint: { font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)" },
  error: { font: "500 12px/18px var(--font-sans)", color: "var(--grade-again)" },
};
