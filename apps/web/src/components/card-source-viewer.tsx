"use client";

import { useEffect, useState } from "react";
import type { CardSourceLocation } from "@deephaus/shared";
import { SkeletonBar } from "@/components/ui/skeleton-bars";

type Props = {
  cardId: string;
};

/** Fetches and renders the exact source segment a card was generated from. */
export function CardSourceViewer({ cardId }: Props) {
  const [data, setData] = useState<CardSourceLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void (async () => {
      try {
        const res = await fetch(`/api/cards/${cardId}/source`, { credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as CardSourceLocation;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load source");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (loading) {
    return (
      <div style={s.wrap}>
        <SkeletonBar width={120} height={14} />
        <SkeletonBar width="100%" height={140} />
        <SkeletonBar width="100%" height={12} />
        <SkeletonBar width="90%" height={12} />
        <SkeletonBar width="80%" height={12} />
      </div>
    );
  }

  if (error) {
    return <div style={s.empty}>{error}</div>;
  }

  const hasContent = Boolean(data && (data.content || data.pageImageUrl));
  if (!data || !hasContent) {
    return (
      <div style={s.empty}>
        <i className="ri-links-line" style={{ fontSize: 28, color: "var(--ink-300)" }} />
        <p style={s.emptyText}>
          This card isn&apos;t linked to a specific source segment. Cards generated
          from a topic (rather than uploaded notes) have no source location.
        </p>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.metaRow}>
        {data.label ? <span style={s.locationChip}>{data.label}</span> : null}
        {data.externalUrl ? (
          <a
            href={data.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <i className="ri-external-link-line" />
            Open original
          </a>
        ) : null}
      </div>

      {data.pageImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.pageImageUrl} alt={data.label ?? "Source page"} style={s.pageImage} />
      ) : null}

      {data.content ? <pre style={s.content}>{data.content}</pre> : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  locationChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    background: "var(--brand-25)",
    color: "var(--teal-700)",
    font: "600 12px/16px var(--font-sans)",
  },
  pageImage: {
    width: "100%",
    height: "auto",
    borderRadius: 8,
    border: "1px solid var(--border-2)",
    background: "var(--paper-soft)",
  },
  content: {
    margin: 0,
    padding: 12,
    background: "var(--paper-soft)",
    border: "1px solid var(--border-1)",
    borderRadius: 8,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--ink-800)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 360,
    overflow: "auto",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 32,
    textAlign: "center",
    color: "var(--fg-4)",
    font: "400 13px/18px var(--font-sans)",
  },
  emptyText: {
    margin: 0,
    maxWidth: 280,
  },
};
