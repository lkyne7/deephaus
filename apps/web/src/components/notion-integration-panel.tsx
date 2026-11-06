"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  disconnectNotion,
  notionConnectHref,
  useNotionStatus,
} from "@/components/notion-page-picker";
import {
  ConnectedPill,
  ConnectionBanner,
  ConnectionMenu,
  ConnectionRow,
} from "@/components/settings/connection-row";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { useOnline } from "@/lib/offline/use-online";

const ICON = "ri-notion-fill";

/** Settings Sources row: connect, change, or disconnect Notion. */
export function NotionIntegrationPanel({ returnTo }: { returnTo?: string }) {
  const online = useOnline();
  if (!online) {
    return (
      <ConnectionRow icon={ICON} name="Notion" detail="Needs an internet connection." />
    );
  }
  return (
    <Suspense
      fallback={<ConnectionRow icon={ICON} name="Notion" detail={<SkeletonBar width="40%" height={10} />} />}
    >
      <NotionIntegrationPanelInner returnTo={returnTo} />
    </Suspense>
  );
}

function NotionIntegrationPanelInner({ returnTo: returnToProp }: { returnTo?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status, loading, refresh } = useNotionStatus();
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState<"change" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnTo = returnToProp ?? pathname;

  useEffect(() => {
    const flag = searchParams.get("notion");
    if (!flag) return;
    if (flag === "connected") {
      setBanner({ kind: "ok", message: "Notion connected." });
      void refresh();
    } else if (flag === "unconfigured") {
      setBanner({
        kind: "error",
        message: "Notion isn't configured on this server.",
      });
    } else if (flag === "upgrade-required") {
      setBanner({ kind: "error", message: "Notion import needs a paid plan." });
    } else if (flag === "error") {
      setBanner({
        kind: "error",
        message: searchParams.get("message") ?? "Could not connect Notion.",
      });
    }
    // Strip only the Notion flags so other params (if any) survive.
    const rest = new URLSearchParams(searchParams);
    rest.delete("notion");
    rest.delete("message");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, refresh]);

  async function changeAccount() {
    setBusy("change");
    setError(null);
    try {
      await disconnectNotion();
      window.location.href = notionConnectHref(returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch Notion account.");
      setBusy(null);
    }
  }

  async function disconnect() {
    const confirmed = window.confirm(
      "Disconnect Notion? Your existing Notion notes stay in DeepHaus, but you won't be able to import or sync until you reconnect.",
    );
    if (!confirmed) return;
    setBusy("disconnect");
    setError(null);
    try {
      await disconnectNotion();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Notion.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <ConnectionRow icon={ICON} name="Notion" detail={<SkeletonBar width="40%" height={10} />} />;
  }

  return (
    <>
      {banner ? (
        <ConnectionBanner kind={banner.kind} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}
      {!status?.configured ? (
        <ConnectionRow
          icon={ICON}
          name="Notion"
          detail="Not configured on this server. Ask an admin to add Notion OAuth credentials."
        />
      ) : status.connected ? (
        <ConnectionRow icon={ICON} name="Notion" detail={status.workspaceName ?? "Connected workspace"}>
          <ConnectedPill />
          <ConnectionMenu
            label="Notion options"
            busy={busy !== null}
            items={[
              { label: "Change account", icon: "ri-refresh-line", onSelect: () => void changeAccount() },
              { label: "Disconnect", icon: "ri-link-unlink-m", onSelect: () => void disconnect() },
            ]}
          />
        </ConnectionRow>
      ) : (
        <ConnectionRow icon={ICON} name="Notion" detail="Turn pages into cards">
          <a className="btn btn-secondary btn-sm" href={notionConnectHref(returnTo)}>
            Connect
          </a>
        </ConnectionRow>
      )}
      {error ? <p className="dhs-error">{error}</p> : null}
    </>
  );
}
