"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SourceType } from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";
import { sourceTypeIconClass, sourceTypeLabel } from "@/lib/sources/file-types";
import { SourceDocumentEditor } from "@/components/source-document-editor";
import { SourceFileViewer } from "@/components/source-file-viewer";

type Props = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  /** Owning deck; null for notes that aren't attached to one. */
  deckId: string | null;
  deckName: string | null;
  /** Canonical Notion page URL for notion sources (open + re-sync). */
  notionUrl: string | null;
  /** Whether the original uploaded file is stored and viewable/downloadable. */
  hasOriginalFile?: boolean;
};

/** Full-page editable view of a single note (source document). */
export function NoteDetailView({
  sourceId,
  sourceType,
  title,
  deckId,
  deckName,
  notionUrl,
  hasOriginalFile = false,
}: Props) {
  const router = useRouter();
  /** Bumped after a re-sync so the editor remounts and refetches the document. */
  const [syncNonce, setSyncNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"notes" | "original">("notes");

  const resync = useCallback(async () => {
    const confirmed = window.confirm(
      "Re-import this page from Notion? Local edits to this note will be replaced with the current Notion content.",
    );
    if (!confirmed) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/sources/${sourceId}/notion-sync`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not re-sync from Notion.");
      setSyncNonce((n) => n + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-sync from Notion.");
    } finally {
      setSyncing(false);
    }
  }, [sourceId, router]);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <Link href="/notes" className="btn btn-ghost btn-sm" aria-label="Back to notes">
            <i className="ri-arrow-left-line" aria-hidden />
            Notes
          </Link>
          <div style={s.titleWrap}>
            <h1 style={s.title}>
              <i className={sourceTypeIconClass(sourceType)} style={s.titleIcon} aria-hidden />
              {title}
            </h1>
            <span style={s.meta}>
              {sourceTypeLabel(sourceType)}
              {deckId && deckName ? (
                <>
                  {" · "}
                  <Link href={`/decks/${deckId}`} style={s.deckLink}>
                    {deckName}
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        </div>
        <div style={s.headerActions}>
          {hasOriginalFile ? (
            <div style={s.tabs}>
              <button
                type="button"
                onClick={() => setViewTab("notes")}
                style={{ ...s.tabBtn, ...(viewTab === "notes" ? s.tabBtnActive : {}) }}
              >
                <i className="ri-edit-2-line" aria-hidden />
                Notes
              </button>
              <button
                type="button"
                onClick={() => setViewTab("original")}
                style={{ ...s.tabBtn, ...(viewTab === "original" ? s.tabBtnActive : {}) }}
              >
                <i className="ri-file-3-line" aria-hidden />
                Original
              </button>
            </div>
          ) : null}
          {sourceType === "notion" && notionUrl ? (
            <>
              <a
                className="btn btn-ghost btn-sm"
                href={notionUrl}
                target="_blank"
                rel="noreferrer"
              >
                <i className="ri-external-link-line" aria-hidden />
                Open in Notion
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void resync()}
                disabled={syncing}
              >
                <i
                  className={syncing ? "ri-loader-4-line icon-spin" : "ri-refresh-line"}
                  aria-hidden
                />
                {syncing ? "Syncing…" : "Re-sync from Notion"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              router.push(
                deckId
                  ? `/create?deck=${deckId}&source=${sourceId}`
                  : `/create?source=${sourceId}`,
              )
            }
          >
            <i className="ri-sparkling-2-line" aria-hidden />
            Generate cards
          </button>
        </div>
      </div>

      {error ? <div style={s.errorBanner}>{error}</div> : null}

      {viewTab === "original" && hasOriginalFile ? (
        <div style={s.viewerWrap}>
          <SourceFileViewer sourceId={sourceId} sourceType={sourceType} />
        </div>
      ) : (
        <div style={s.editorWrap}>
          <SourceDocumentEditor key={syncNonce} sourceId={sourceId} showToolbar={false} />
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "16px 24px",
    borderBottom: "1px solid var(--border-1)",
    flexWrap: "wrap",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
  },
  titleWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  title: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    font: "600 16px/22px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 520,
  },
  titleIcon: {
    fontSize: 17,
    color: "var(--ink-500)",
    flexShrink: 0,
  },
  meta: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  deckLink: {
    color: "var(--teal-700)",
    textDecoration: "none",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  errorBanner: {
    margin: "12px 24px 0",
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--grade-again-bg)",
    border: "1px solid rgba(217, 45, 32, 0.32)",
    color: "var(--grade-again)",
    font: "500 13px/18px var(--font-sans)",
  },
  editorWrap: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "20px 24px 48px",
  },
  viewerWrap: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  tabs: {
    display: "inline-flex",
    padding: 3,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    gap: 3,
  },
  tabBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    background: "transparent",
    color: "var(--ink-500)",
    border: "1px solid transparent",
    borderRadius: 6,
    font: "500 13px/16px var(--font-sans)",
    cursor: "pointer",
  },
  tabBtnActive: {
    background: "var(--white)",
    color: "var(--ink-900)",
    border: "1px solid var(--border-secondary)",
  },
};
