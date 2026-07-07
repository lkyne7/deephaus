"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SourceType } from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";
import { sourceTypeIconClass, sourceTypeLabel } from "@/lib/sources/file-types";
import { AnimatedModal } from "@/components/motion/animated-modal";
import {
  NotionPagePicker,
  useNotionStatus,
  type NotionPageSummary,
} from "@/components/notion-page-picker";
import { UntitledSearchInput, UntitledSelect } from "@/components/ui/untitled-controls";
import { CardListSkeleton } from "@/components/ui/skeleton-patterns";

type NoteListItem = {
  id: string;
  type: SourceType;
  title: string;
  deckId: string;
  deckName: string;
  createdAt: string;
  updatedAt: string;
};

type DeckOption = { id: string; name: string };

const NEW_DECK_VALUE = "__new__";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Unified notes library: every source across decks, plus Notion import. */
export function NotesClientView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh: refreshNotionStatus } = useNotionStatus();

  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  // Surface the OAuth round-trip result (?notion=connected|error|unconfigured).
  useEffect(() => {
    const flag = searchParams.get("notion");
    if (!flag) return;
    if (flag === "connected") {
      setBanner({ kind: "ok", message: "Notion connected. Pick a page to import." });
      setImportOpen(true);
      void refreshNotionStatus();
    } else if (flag === "unconfigured") {
      setBanner({
        kind: "error",
        message: "Notion isn't configured on the server (missing NOTION_CLIENT_ID / SECRET).",
      });
    } else if (flag === "error") {
      setBanner({
        kind: "error",
        message: searchParams.get("message") ?? "Could not connect Notion.",
      });
    }
    router.replace("/notes", { scroll: false });
  }, [searchParams, router, refreshNotionStatus]);

  const loadNotes = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notes");
      const data = (await res.json()) as { notes?: NoteListItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load notes.");
      setNotes(data.notes ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.deckName.toLowerCase().includes(q) ||
        sourceTypeLabel(note.type).toLowerCase().includes(q),
    );
  }, [notes, query]);

  return (
    <div style={s.page}>
      <div style={s.headerRow}>
        <div style={s.headerText}>
          <h1 style={s.title}>Notes</h1>
        </div>
        <div style={s.headerActions}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setImportOpen(true)}
          >
            <i className="ri-notion-line" aria-hidden />
            Import from Notion
          </button>
        </div>
      </div>

      {banner ? (
        <div style={{ ...s.banner, ...(banner.kind === "error" ? s.bannerError : s.bannerOk) }}>
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

      <UntitledSearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search notes by title, deck, or type…"
        aria-label="Search notes"
        wrapperStyle={s.searchRow}
      />

      {loading ? (
        <CardListSkeleton />
      ) : error ? (
        <div style={s.stateBox}>
          <span style={s.hint}>{error}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={s.stateBox}>
          <i className="ri-sticky-note-line" style={s.stateIcon} aria-hidden />
          <span style={s.stateTitle}>
            {notes.length === 0 ? "No notes yet" : "No notes match that search"}
          </span>
          <span style={s.hint}>
            {notes.length === 0
              ? "Add a source on the Create page or import a Notion page to get started."
              : "Try a different search."}
          </span>
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map((note) => (
            <button
              key={note.id}
              type="button"
              style={s.card}
              onClick={() => router.push(`/notes/${note.id}`)}
            >
              <div style={s.cardTop}>
                <i className={sourceTypeIconClass(note.type)} style={s.cardIcon} aria-hidden />
                <span style={s.cardType}>{sourceTypeLabel(note.type)}</span>
                <span style={s.cardDate}>{formatDate(note.updatedAt)}</span>
              </div>
              <span style={s.cardTitle}>{note.title}</span>
              <span style={s.cardDeck}>
                <i className="ri-folder-3-line" aria-hidden />
                {note.deckName}
              </span>
            </button>
          ))}
        </div>
      )}

      {importOpen ? (
        <NotionImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(sourceId) => {
            setImportOpen(false);
            router.push(`/notes/${sourceId}`);
          }}
        />
      ) : null}
    </div>
  );
}

function NotionImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (sourceId: string) => void;
}) {
  const [page, setPage] = useState<NotionPageSummary | null>(null);
  const [decks, setDecks] = useState<DeckOption[]>([]);
  const [deckValue, setDeckValue] = useState<string>(NEW_DECK_VALUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/projects");
        if (!res.ok) return;
        const data = (await res.json()) as Array<{
          id: string;
          name: string | null;
          deck_name: string | null;
        }>;
        if (!cancelled) {
          setDecks(data.map((p) => ({ id: p.id, name: p.deck_name ?? p.name ?? "Untitled deck" })));
        }
      } catch {
        // Deck list is optional; "new deck" still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const importPage = useCallback(async () => {
    if (!page) return;
    setBusy(true);
    setError(null);
    try {
      let projectId = deckValue;
      if (deckValue === NEW_DECK_VALUE) {
        const projectRes = await apiFetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: page.title, deck_name: page.title }),
        });
        const project = (await projectRes.json()) as { id?: string; error?: string };
        if (!projectRes.ok || !project.id) {
          throw new Error(project.error ?? "Could not create a deck for this note.");
        }
        projectId = project.id;
      }

      const res = await apiFetch("/api/sources/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, page_id: page.id }),
      });
      const source = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !source.id) {
        throw new Error(source.error ?? "Could not import the Notion page.");
      }
      onImported(source.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import the Notion page.");
    } finally {
      setBusy(false);
    }
  }, [page, deckValue, onImported]);

  return (
    <AnimatedModal title="Import from Notion" onClose={busy ? () => {} : onClose} maxWidth={520}>
      <div style={s.dialogBody}>
        <NotionPagePicker
          returnTo="/notes"
          selectedPageId={page?.id ?? null}
          onSelect={setPage}
          disabled={busy}
        />

        <div className="field" style={{ marginTop: 4 }}>
          <label className="field-label" htmlFor="notion-import-deck">
            Add to deck
          </label>
          <UntitledSelect
            id="notion-import-deck"
            icon="ri-stack-line"
            value={deckValue}
            onChange={(e) => setDeckValue(e.target.value)}
            disabled={busy}
            wrapperStyle={s.dialogDeckSelect}
          >
            <option value={NEW_DECK_VALUE}>
              {page ? `New deck: “${page.title}”` : "New deck (named after the page)"}
            </option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </UntitledSelect>
        </div>

        {error ? <span style={s.dialogError}>{error}</span> : null}

        <div style={s.dialogActions}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void importPage()}
            disabled={!page || busy}
          >
            {busy ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            {busy ? "Importing…" : "Import page"}
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    padding: "32px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 260,
  },
  title: {
    margin: 0,
    font: "600 22px/28px var(--font-sans)",
    color: "var(--ink-900)",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    font: "500 13px/18px var(--font-sans)",
  },
  bannerOk: {
    background: "var(--brand-25)",
    border: "1px solid var(--brand-100)",
    color: "var(--ink-900)",
  },
  bannerError: {
    background: "var(--grade-again-bg)",
    border: "1px solid rgba(217, 45, 32, 0.32)",
    color: "var(--grade-again)",
  },
  bannerClose: {
    border: 0,
    background: "transparent",
    cursor: "pointer",
    color: "inherit",
    fontSize: 16,
    padding: 2,
  },
  searchRow: {
    maxWidth: 460,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: 14,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border-2)",
    background: "var(--white)",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 120ms ease, box-shadow 120ms ease",
  },
  cardTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  cardIcon: {
    fontSize: 16,
    color: "var(--ink-500)",
  },
  cardType: {
    font: "500 11px/16px var(--font-sans)",
    color: "var(--ink-500)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  cardDate: {
    marginLeft: "auto",
    font: "400 11px/16px var(--font-sans)",
    color: "var(--ink-400)",
  },
  cardTitle: {
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  cardDeck: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  stateBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "48px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 10,
    background: "var(--paper-soft)",
    textAlign: "center",
  },
  stateIcon: {
    fontSize: 28,
    color: "var(--ink-400)",
  },
  stateTitle: {
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  hint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  dialogBody: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  dialogError: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
  dialogActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  dialogDeckSelect: {
    width: "100%",
  },
};
