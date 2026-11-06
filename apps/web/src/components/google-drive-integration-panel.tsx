"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { googleDriveConnectHref } from "@/components/google-drive-picker";
import {
  ConnectedPill,
  ConnectionBanner,
  ConnectionMenu,
  ConnectionRow,
} from "@/components/settings/connection-row";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { useOnline } from "@/lib/offline/use-online";

type DriveStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail?: string | null;
  accountName?: string | null;
};

const ICON = "ri-drive-fill";

/** Settings Sources row: connect, change, or disconnect Google Drive. */
export function GoogleDriveIntegrationPanel({ returnTo }: { returnTo?: string }) {
  const online = useOnline();
  if (!online) {
    return <ConnectionRow icon={ICON} name="Google Drive" detail="Needs an internet connection." />;
  }
  return (
    <Suspense
      fallback={<ConnectionRow icon={ICON} name="Google Drive" detail={<SkeletonBar width="40%" height={10} />} />}
    >
      <PanelInner returnTo={returnTo} />
    </Suspense>
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
    } else if (flag === "upgrade-required") {
      setBanner({ kind: "error", message: "Google Drive import needs a paid plan." });
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
    return (
      <ConnectionRow icon={ICON} name="Google Drive" detail={<SkeletonBar width="40%" height={10} />} />
    );
  }

  return (
    <>
      {banner ? (
        <ConnectionBanner kind={banner.kind} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}
      {!status?.configured ? (
        <ConnectionRow
          icon={ICON}
          name="Google Drive"
          detail="Not configured on this server. Ask an admin to add Google OAuth credentials."
        />
      ) : status.connected ? (
        <ConnectionRow
          icon={ICON}
          name="Google Drive"
          detail={status.accountEmail ?? status.accountName ?? "Connected account"}
        >
          <ConnectedPill />
          <ConnectionMenu
            label="Google Drive options"
            busy={busy !== null}
            items={[
              { label: "Change account", icon: "ri-refresh-line", onSelect: () => void changeAccount() },
              { label: "Disconnect", icon: "ri-link-unlink-m", onSelect: () => void disconnect() },
            ]}
          />
        </ConnectionRow>
      ) : (
        <ConnectionRow icon={ICON} name="Google Drive" detail="Import files you pick from your Drive">
          <a className="btn btn-secondary btn-sm" href={googleDriveConnectHref(returnTo)}>
            Connect
          </a>
        </ConnectionRow>
      )}
      {error ? <p className="dhs-error">{error}</p> : null}
    </>
  );
}
