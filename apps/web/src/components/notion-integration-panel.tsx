"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  NotionConnectionBar,
  notionConnectHref,
  useNotionStatus,
} from "@/components/notion-page-picker";

/** Settings integrations card: connect, change, or disconnect Notion. */
export function NotionIntegrationPanel({ returnTo }: { returnTo?: string }) {
  return (
    <Suspense fallback={<NotionIntegrationPanelShell loading />}>
      <NotionIntegrationPanelInner returnTo={returnTo} />
    </Suspense>
  );
}

function NotionIntegrationPanelShell({
  loading,
  children,
}: {
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <section style={s.card}>
      <div style={s.sectionHead}>
        <div>
          <h2 style={s.sectionTitle}>Notion</h2>
          <p style={s.sectionSub}>
            Import Notion pages as editable notes and generate flashcards from them on Create
            and Notes.
          </p>
        </div>
      </div>
      {loading ? (
        <div style={s.stateBox}>
          <i className="ri-loader-4-line icon-spin" aria-hidden />
          <span style={s.stateHint}>Checking Notion connection…</span>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function NotionIntegrationPanelInner({ returnTo: returnToProp }: { returnTo?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status, loading, refresh } = useNotionStatus();
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
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

  if (loading) {
    return <NotionIntegrationPanelShell loading />;
  }

  if (!status?.configured) {
    return (
      <NotionIntegrationPanelShell>
        <div style={s.stateBox}>
          <i className="ri-notion-line" style={s.stateIcon} aria-hidden />
          <span style={s.stateTitle}>Notion isn&apos;t configured on this server</span>
          <span style={s.stateHint}>Ask an admin to add Notion OAuth credentials.</span>
        </div>
      </NotionIntegrationPanelShell>
    );
  }

  return (
    <NotionIntegrationPanelShell>
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
        <NotionConnectionBar
          status={status}
          returnTo={returnTo}
          onDisconnected={() => void refresh()}
        />
      ) : (
        <div style={s.connectRow}>
          <div style={s.connectCopy}>
            <span style={s.stateTitle}>No workspace connected</span>
            <span style={s.stateHint}>
              Authorize DeepHaus to read pages you share from Notion.
            </span>
          </div>
          <a className="btn btn-primary" href={notionConnectHref(returnTo)}>
            <i className="ri-notion-fill" aria-hidden />
            Connect Notion
          </a>
        </div>
      )}
    </NotionIntegrationPanelShell>
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
};
