"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { googleDriveConnectHref } from "@/components/google-drive-picker";
import { OfflineNotice } from "@/components/offline-gate";
import { ConnectionStatusSkeleton } from "@/components/ui/skeleton-patterns";
import { useOnline } from "@/lib/offline/use-online";

type DriveStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail?: string | null;
  accountName?: string | null;
};

/** Settings integrations card: connect, change, or disconnect Google Drive. */
export function GoogleDriveIntegrationPanel({ returnTo }: { returnTo?: string }) {
  const online = useOnline();
  if (!online) {
    return (
      <PanelShell>
        <OfflineNotice feature="The Google Drive integration" />
      </PanelShell>
    );
  }
  return (
    <Suspense fallback={<PanelShell loading />}>
      <PanelInner returnTo={returnTo} />
    </Suspense>
  );
}

function PanelShell({ loading, children }: { loading?: boolean; children?: ReactNode }) {
  return (
    <section style={s.card}>
      <div style={s.sectionHead}>
        <div>
          <h2 style={s.sectionTitle}>Google Drive</h2>
          <p style={s.sectionSub}>
            Import Docs, Slides, Sheets, PDFs, and Office files from your Drive as sources on the
            Create page. DeepHaus can only access files you explicitly pick.
          </p>
        </div>
      </div>
      {loading ? <ConnectionStatusSkeleton /> : children}
    </section>
  );
}

function PanelInner({ returnTo: returnToProp }: { returnTo?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = returnToProp ?? pathname;

  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"change" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

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

  useEffect(() => {
    const flag = searchParams.get("googleDrive");
    if (!flag) return;
    if (flag === "connected") {
      setBanner({ kind: "ok", message: "Google Drive connected." });
      void refresh();
    } else if (flag === "unconfigured") {
      setBanner({ kind: "error", message: "Google Drive isn't configured on this server." });
    } else if (flag === "error") {
      setBanner({
        kind: "error",
        message: searchParams.get("message") ?? "Could not connect Google Drive.",
      });
    }
    const rest = new URLSearchParams(searchParams);
    rest.delete("googleDrive");
    rest.delete("message");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, refresh]);

  const removeConnection = useCallback(async () => {
    const res = await apiFetch("/api/google-drive/connection", { method: "DELETE" });
    if (!res.ok) throw new Error("Could not disconnect Google Drive.");
  }, []);

  const changeAccount = useCallback(async () => {
    setBusy("change");
    setError(null);
    try {
      await removeConnection();
      window.location.href = googleDriveConnectHref(returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch Google account.");
      setBusy(null);
    }
  }, [removeConnection, returnTo]);

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
    return <PanelShell loading />;
  }

  if (!status?.configured) {
    return (
      <PanelShell>
        <div style={s.stateBox}>
          <i className="ri-google-fill" style={s.stateIcon} aria-hidden />
          <span style={s.stateTitle}>Google Drive isn&apos;t configured on this server</span>
          <span style={s.stateHint}>Ask an admin to add Google OAuth credentials.</span>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      {banner ? (
        <div
          style={{
            ...s.banner,
            ...(banner.kind === "error" ? s.bannerError : s.bannerOk),
          }}
        >
          <span>{banner.message}</span>
          <button
            type="button"
            style={s.bannerClose}
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </div>
      ) : null}

      {status.connected ? (
        <div style={s.connectionBar}>
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
          {error ? <span style={s.error}>{error}</span> : null}
        </div>
      ) : (
        <div style={s.connectRow}>
          <div style={s.connectCopy}>
            <span style={s.stateTitle}>No account connected</span>
            <span style={s.stateHint}>
              Authorize DeepHaus to import files you pick from Google Drive.
            </span>
          </div>
          <a className="btn btn-primary" href={googleDriveConnectHref(returnTo)}>
            <i className="ri-google-fill" aria-hidden />
            Connect Google Drive
          </a>
        </div>
      )}
    </PanelShell>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  sectionHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  sectionTitle: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
  },
  sectionSub: {
    font: "400 14px/22px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    maxWidth: 560,
  },
  stateBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "20px 16px",
    border: "1px dashed var(--border-tertiary)",
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    textAlign: "center",
  },
  stateIcon: {
    fontSize: 26,
    color: "var(--fg-quaternary)",
  },
  stateTitle: {
    font: "600 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  stateHint: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-tertiary)",
  },
  connectRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface-2)",
  },
  connectCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  connectionBar: {
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
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 8,
    font: "400 13px/18px var(--font-sans)",
  },
  bannerOk: {
    background: "var(--brand-50)",
    color: "var(--fg-primary)",
    border: "1px solid var(--brand-200)",
  },
  bannerError: {
    background: "var(--grade-again-bg, #fef2f2)",
    color: "var(--grade-again)",
    border: "1px solid var(--grade-again-border, #fecaca)",
  },
  bannerClose: {
    border: 0,
    background: "transparent",
    cursor: "pointer",
    color: "inherit",
    fontSize: 16,
    padding: 2,
    flexShrink: 0,
  },
  error: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
