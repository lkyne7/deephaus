"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";

export type NotionStatus = {
  configured: boolean;
  connected: boolean;
  workspaceName?: string | null;
  workspaceIcon?: string | null;
};

export type NotionPageSummary = {
  id: string;
  title: string;
  icon: string | null;
  iconType: "emoji" | "url" | null;
  url: string | null;
  lastEdited: string | null;
};

/** Connection state shared by the Create page picker and the Notes page. */
export function useNotionStatus() {
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notion/status");
      if (!res.ok) throw new Error("status failed");
      setStatus((await res.json()) as NotionStatus);
    } catch {
      setStatus({ configured: false, connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, refresh };
}

export function notionConnectHref(returnTo: string): string {
  return `/api/notion/connect?returnTo=${encodeURIComponent(returnTo)}`;
}

function formatEdited(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PageIcon({ page }: { page: NotionPageSummary }) {
  if (page.iconType === "emoji" && page.icon) {
    return <span style={pk.pageEmoji}>{page.icon}</span>;
  }
  if (page.iconType === "url" && page.icon) {
    return (
      <Image src={page.icon} alt="" width={18} height={18} style={pk.pageImgIcon} unoptimized />
    );
  }
  return <i className="ri-file-text-line" style={pk.pageFallbackIcon} aria-hidden />;
}

type Props = {
  onSelect: (page: NotionPageSummary) => void;
  selectedPageId?: string | null;
  /** Path to return to after the OAuth connect round-trip. */
  returnTo: string;
  disabled?: boolean;
};

/**
 * Searchable list of the user's Notion pages, with connect/unconfigured
 * states. Used by the Create page Notion tab and the Notes import dialog.
 */
export function NotionPagePicker({ onSelect, selectedPageId, returnTo, disabled }: Props) {
  const { status, loading: statusLoading } = useNotionStatus();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pages, setPages] = useState<NotionPageSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchPages = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("query", debouncedQuery);
      if (cursor) params.set("cursor", cursor);
      const res = await apiFetch(`/api/notion/pages?${params.toString()}`);
      const data = (await res.json()) as {
        pages?: NotionPageSummary[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load Notion pages.");
      return { pages: data.pages ?? [], nextCursor: data.nextCursor ?? null };
    },
    [debouncedQuery],
  );

  useEffect(() => {
    if (!status?.connected) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPages();
        if (!cancelled) {
          setPages(result.pages);
          setNextCursor(result.nextCursor);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load Notion pages.");
          setPages([]);
          setNextCursor(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status?.connected, fetchPages]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchPages(nextCursor);
      setPages((prev) => [...prev, ...result.pages]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more pages.");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPages, nextCursor, loadingMore]);

  const connectHref = useMemo(() => notionConnectHref(returnTo), [returnTo]);

  if (statusLoading) {
    return (
      <div style={pk.stateBox}>
        <i className="ri-loader-4-line icon-spin" aria-hidden />
        <span style={pk.hint}>Checking Notion connection…</span>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div style={pk.stateBox}>
        <i className="ri-notion-line" style={pk.stateIcon} aria-hidden />
        <span style={pk.stateTitle}>Notion isn&apos;t configured</span>
        <span style={pk.hint}>
          Add <code>NOTION_CLIENT_ID</code> and <code>NOTION_CLIENT_SECRET</code> to the{" "}
          <strong>Production</strong> environment in Vercel, then redeploy. Also set{" "}
          <code>NOTION_REDIRECT_URI</code> to{" "}
          <code>https://www.deephaus.ai/api/notion/callback</code> and register that exact URI in
          your Notion integration&apos;s OAuth settings.
        </span>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div style={pk.stateBox}>
        <i className="ri-notion-line" style={pk.stateIcon} aria-hidden />
        <span style={pk.stateTitle}>Connect your Notion workspace</span>
        <span style={pk.hint}>
          Pick which pages DeepHaus can read, then turn them into flashcards.
        </span>
        <a className="btn btn-primary btn-sm" href={connectHref} style={{ marginTop: 4 }}>
          <i className="ri-notion-fill" aria-hidden />
          Connect Notion
        </a>
      </div>
    );
  }

  return (
    <div style={pk.wrap}>
      <UntitledSearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Notion pages…"
        disabled={disabled}
        aria-label="Search Notion pages"
      />

      {error ? <span style={pk.error}>{error}</span> : null}

      <div style={pk.list} role="listbox" aria-label="Notion pages">
        {loading ? (
          <div style={pk.listState}>
            <i className="ri-loader-4-line icon-spin" aria-hidden />
            <span style={pk.hint}>Loading pages…</span>
          </div>
        ) : pages.length === 0 ? (
          <div style={pk.listState}>
            <span style={pk.hint}>
              {debouncedQuery
                ? "No pages match that search."
                : "No pages shared yet. Share pages with DeepHaus from Notion, or reconnect to pick more."}
            </span>
          </div>
        ) : (
          pages.map((page) => {
            const selected = page.id === selectedPageId;
            return (
              <button
                key={page.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(page)}
                disabled={disabled}
                style={{ ...pk.pageRow, ...(selected ? pk.pageRowSelected : {}) }}
              >
                <PageIcon page={page} />
                <span style={pk.pageTitle}>{page.title}</span>
                {formatEdited(page.lastEdited) ? (
                  <span style={pk.pageMeta}>{formatEdited(page.lastEdited)}</span>
                ) : null}
                {selected ? (
                  <i className="ri-check-line" style={pk.pageCheck} aria-hidden />
                ) : null}
              </button>
            );
          })
        )}
        {!loading && nextCursor ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={pk.loadMore}
            onClick={() => void loadMore()}
            disabled={loadingMore || disabled}
          >
            {loadingMore ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            Load more
          </button>
        ) : null}
      </div>
    </div>
  );
}

const pk: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  list: {
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "auto",
    maxHeight: 320,
    background: "var(--white)",
  },
  listState: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "16px 14px",
    color: "var(--ink-500)",
  },
  pageRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    border: "none",
    borderBottom: "1px solid var(--border-1)",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
  },
  pageRowSelected: {
    background: "var(--brand-25)",
  },
  pageEmoji: {
    fontSize: 16,
    lineHeight: "18px",
    width: 18,
    textAlign: "center",
    flexShrink: 0,
  },
  pageImgIcon: {
    borderRadius: 3,
    objectFit: "cover",
    flexShrink: 0,
  },
  pageFallbackIcon: {
    fontSize: 16,
    color: "var(--ink-400)",
    width: 18,
    textAlign: "center",
    flexShrink: 0,
  },
  pageTitle: {
    flex: 1,
    minWidth: 0,
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pageMeta: {
    font: "400 11px/16px var(--font-sans)",
    color: "var(--ink-400)",
    flexShrink: 0,
  },
  pageCheck: {
    color: "var(--teal-500)",
    fontSize: 16,
    flexShrink: 0,
  },
  loadMore: {
    width: "100%",
    justifyContent: "center",
    borderRadius: 0,
  },
  stateBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "28px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 8,
    background: "var(--paper-soft)",
    textAlign: "center",
  },
  stateIcon: {
    fontSize: 26,
    color: "var(--ink-400)",
  },
  stateTitle: {
    font: "600 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  hint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  error: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
