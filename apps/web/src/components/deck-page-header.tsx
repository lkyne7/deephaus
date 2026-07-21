"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { PageHeaderSlot } from "@/components/page-header-context";
import { RenameDeckDialog } from "@/components/rename-deck-dialog";

type Props = {
  title: string;
  deckId: string;
  cardCount: number;
  jobId: string | null;
  due: number;
  newCount: number;
  showStudy: boolean;
};

const DECKS_BACK = { href: "/decks", label: "Decks" } as const;

export function DeckPageHeader({
  title: initialTitle,
  deckId,
  cardCount,
  jobId,
  due,
  newCount,
  showStudy,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [renameOpen, setRenameOpen] = useState(false);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle, deckId]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportApkg = useCallback(async () => {
    if (!jobId) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: deckId, job_id: jobId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9-_]+/gi, "-")}.apkg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [deckId, jobId, title]);

  return (
    <>
      <PageHeaderSlot title={title} back={DECKS_BACK} />

      <div>
        <DashboardSectionHeader
          title={title}
          trailing={
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRenameOpen(true)}
              aria-label="Rename deck"
              title="Rename deck"
              style={s.renameBtn}
            >
              <i className="ri-pencil-line" aria-hidden />
            </button>
          }
          rightAction={
            <div className="dh-toolbar-actions">
              <Link href={`/cards?deck=${deckId}`} className="btn btn-ghost btn-sm">
                <i className="ri-table-line" aria-hidden />
                Browse cards
              </Link>
              <Link href={`/create?deck=${deckId}`} className="btn btn-ghost btn-sm">
                <i className="ri-add-line" aria-hidden />
                Create cards
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void exportApkg()}
                disabled={exporting || !jobId || cardCount === 0}
                title={!jobId ? "Export is available after cards are generated" : undefined}
              >
                <i className={exporting ? "ri-loader-4-line icon-spin" : "ri-download-2-line"} aria-hidden />
                {exporting ? "Exporting…" : "Export .apkg"}
              </button>
              {showStudy ? (
                <Link href={`/decks/${deckId}/study`} className="btn btn-primary btn-sm">
                  <i className="ri-book-open-line" aria-hidden />
                  Study
                </Link>
              ) : null}
            </div>
          }
        />

        <div style={s.statsRow}>
          <span className="chip chip-neutral">
            <i className="ri-stack-line" style={{ marginRight: 4 }} aria-hidden />
            {cardCount.toLocaleString()} {cardCount === 1 ? "card" : "cards"}
          </span>
          <span className="chip chip-due">
            <span className="chip-dot" />
            {due.toLocaleString()} due
          </span>
          <span className="chip chip-new">
            <span className="chip-dot" />
            {newCount.toLocaleString()} new
          </span>
        </div>
      </div>

      {exportError ? (
        <div style={s.exportError} role="alert">
          {exportError}
        </div>
      ) : null}

      <RenameDeckDialog
        open={renameOpen}
        projectId={deckId}
        currentName={title}
        onClose={() => setRenameOpen(false)}
        onRenamed={(name) => {
          setTitle(name);
          router.refresh();
        }}
      />
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  renameBtn: {
    padding: "4px 6px",
    minWidth: 0,
  },
  statsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: -6,
    marginBottom: 4,
  },
  exportError: {
    marginTop: -8,
    marginBottom: 8,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
