"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeckGrid, type DeckGridRow } from "@/components/deck-grid";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { formatRelative } from "@/lib/fsrs/dashboard-decks";

export type DeckTableInput = {
  deck_id: string;
  name: string;
  due: number;
  new: number;
  last_reviewed: string | null;
  total: number;
  new_card_count: number;
  is_community?: boolean;
  is_published?: boolean;
};

type Props = {
  decks: DeckTableInput[];
  /** When false, every deck is shown at once with no "Show all" toggle. */
  collapsible?: boolean;
};

type SortKey = "priority" | "name" | "progress" | "new" | "due" | "lastReviewed";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "grid";

const DEFAULT_VISIBLE = 7;

type Row = {
  id: string;
  title: string;
  total: number;
  newCount: number;
  dueCount: number;
  progress: number;
  lastReviewedRaw: string | null;
  lastReviewedLabel: string | null;
  isCommunity: boolean;
  isPublished: boolean;
};

const COLUMNS: Array<{ key: SortKey; label: string; width?: number }> = [
  { key: "name", label: "Deck name" },
  { key: "progress", label: "Progress", width: 200 },
  { key: "new", label: "New", width: 88 },
  { key: "due", label: "Due", width: 88 },
  { key: "lastReviewed", label: "Last reviewed", width: 150 },
];

/** Default sort direction when a column is first activated. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  priority: "desc",
  name: "asc",
  progress: "desc",
  new: "desc",
  due: "desc",
  lastReviewed: "desc",
};

function toRow(d: DeckTableInput): Row {
  const progress =
    d.total > 0 ? Math.min(1, Math.max(0, (d.total - d.new_card_count) / d.total)) : 0;
  return {
    id: d.deck_id,
    title: d.name,
    total: d.total,
    newCount: d.new,
    dueCount: d.due,
    progress,
    lastReviewedRaw: d.last_reviewed,
    lastReviewedLabel: formatRelative(d.last_reviewed),
    isCommunity: d.is_community ?? false,
    isPublished: d.is_published ?? false,
  };
}

function compareRows(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "name":
      return a.title.localeCompare(b.title);
    case "progress":
      return a.progress - b.progress;
    case "new":
      return a.newCount - b.newCount;
    case "due":
      return a.dueCount - b.dueCount;
    case "lastReviewed": {
      const av = a.lastReviewedRaw ? new Date(a.lastReviewedRaw).getTime() : 0;
      const bv = b.lastReviewedRaw ? new Date(b.lastReviewedRaw).getTime() : 0;
      return av - bv;
    }
    case "priority":
    default:
      return a.dueCount + a.newCount - (b.dueCount + b.newCount);
  }
}

export function DashboardDecksTable({ decks, collapsible = true }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [view, setView] = useState<ViewMode>("table");
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => decks.map(toRow), [decks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? rows.filter((r) => r.title.toLowerCase().includes(needle))
      : rows;
    const sorted = [...base].sort((a, b) => {
      const cmp = compareRows(a, b, sortKey);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, query, sortKey, sortDir]);

  const canCollapse = collapsible && filtered.length > DEFAULT_VISIBLE;
  const visible = canCollapse && !showAll ? filtered.slice(0, DEFAULT_VISIBLE) : filtered;

  const gridRows: DeckGridRow[] = useMemo(
    () =>
      visible.map((r) => ({
        id: r.id,
        title: r.title,
        newCount: r.newCount,
        dueCount: r.dueCount,
        totalCount: r.total,
        lastReviewed: r.lastReviewedLabel,
        isCommunity: r.isCommunity,
        isPublished: r.isPublished,
      })),
    [visible],
  );

  function activateSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  }

  return (
    <section>
      <DashboardSectionHeader
        title="Your decks"
        icon="ri-folder-3-line"
        count={decks.length}
        rightAction={
          <div style={s.toolbar}>
            <UntitledSearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search decks"
              aria-label="Search decks"
              wrapperStyle={s.search}
            />
            <div style={s.viewToggle} role="group" aria-label="Deck view">
              <ViewButton
                active={view === "table"}
                icon="ri-list-check"
                label="Table view"
                onClick={() => setView("table")}
              />
              <ViewButton
                active={view === "grid"}
                icon="ri-layout-grid-line"
                label="Grid view"
                onClick={() => setView("grid")}
              />
            </div>
          </div>
        }
      />

      {decks.length === 0 ? (
        <DeckGrid decks={[]} />
      ) : filtered.length === 0 ? (
        <div style={s.noMatches}>
          <i className="ri-search-line" style={{ fontSize: 26, color: "var(--ink-200)" }} />
          <div style={{ font: "500 15px/22px var(--font-sans)", color: "var(--ink-700)" }}>
            No decks match “{query.trim()}”
          </div>
        </div>
      ) : view === "grid" ? (
        <>
          <DeckGrid decks={gridRows} studyButton />
          {canCollapse ? (
            <ShowAllToggle
              showAll={showAll}
              total={filtered.length}
              onToggle={() => setShowAll((v) => !v)}
              variant="plain"
            />
          ) : null}
        </>
      ) : (
        <div style={s.tableCard}>
          <table style={s.table}>
            <thead>
              <tr>
                {COLUMNS.map((col) => {
                  const active = sortKey === col.key;
                  return (
                    <th key={col.key} style={{ ...s.th, width: col.width }}>
                      <button
                        type="button"
                        style={{ ...s.thButton, color: active ? "var(--ink-700)" : "var(--fg-4)" }}
                        onClick={() => activateSort(col.key)}
                      >
                        {col.label}
                        <i
                          className={
                            active
                              ? sortDir === "asc"
                                ? "ri-arrow-up-s-line"
                                : "ri-arrow-down-s-line"
                              : "ri-arrow-up-down-line"
                          }
                          style={{ ...s.sortIcon, opacity: active ? 1 : 0.4 }}
                          aria-hidden
                        />
                      </button>
                    </th>
                  );
                })}
                <th style={{ ...s.th, width: 96 }} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  style={s.tr}
                  className="dh-deck-table-row"
                  onClick={() => router.push(`/decks/${r.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/decks/${r.id}`);
                  }}
                >
                  <td style={s.td}>
                    <div style={s.nameCell}>
                      <span
                        style={
                          r.isCommunity
                            ? s.communityIcon
                            : r.isPublished
                              ? s.sharedIcon
                              : s.folderIcon
                        }
                      >
                        <i
                          className={
                            r.isCommunity
                              ? "ri-earth-line"
                              : r.isPublished
                                ? "ri-share-forward-line"
                                : "ri-folder-3-line"
                          }
                          aria-hidden
                        />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={s.deckName}>{r.title}</span>
                        <span style={s.deckSub}>
                          {r.total.toLocaleString()} cards
                          {r.isCommunity ? (
                            <span style={s.communityTag}>· Community</span>
                          ) : null}
                          {r.isPublished ? (
                            <span style={s.sharedTag}>· Shared</span>
                          ) : null}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td style={s.td}>
                    <div style={s.progressCell}>
                      <span style={s.progressTrack}>
                        <span
                          style={{ ...s.progressFill, width: `${Math.round(r.progress * 100)}%` }}
                        />
                      </span>
                      <span style={s.progressPct}>{Math.round(r.progress * 100)}%</span>
                    </div>
                  </td>
                  <td style={s.td}>
                    <span className="chip chip-new">{r.newCount}</span>
                  </td>
                  <td style={s.td}>
                    {r.dueCount > 0 ? (
                      <span className="chip chip-due">{r.dueCount}</span>
                    ) : (
                      <span className="chip chip-neutral">0</span>
                    )}
                  </td>
                  <td style={s.td}>
                    <span style={s.lastReviewed}>{r.lastReviewedLabel ?? "—"}</span>
                  </td>
                  <td style={{ ...s.td, textAlign: "right" }}>
                    <Link
                      href={`/decks/${r.id}/study`}
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Study
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canCollapse ? (
            <ShowAllToggle
              showAll={showAll}
              total={filtered.length}
              onToggle={() => setShowAll((v) => !v)}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      style={{
        ...s.viewButton,
        background: active ? "var(--white)" : "transparent",
        color: active ? "var(--ink-700)" : "var(--fg-4)",
        boxShadow: active ? "var(--shadow-xs, 0 1px 2px rgba(16,24,40,0.05))" : "none",
      }}
    >
      <i className={icon} aria-hidden />
    </button>
  );
}

function ShowAllToggle({
  showAll,
  total,
  onToggle,
  variant = "card",
}: {
  showAll: boolean;
  total: number;
  onToggle: () => void;
  variant?: "card" | "plain";
}) {
  return (
    <div style={variant === "card" ? s.showAll : s.showAllPlain}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
        {showAll ? "Show less" : `Show all ${total.toLocaleString()} decks`}
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "nowrap",
    flexShrink: 0,
  },
  search: {
    width: 260,
    maxWidth: "100%",
  },
  viewToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    padding: 3,
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-1)",
  },
  viewButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 28,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 16,
    transition: "background 120ms ease, color 120ms ease",
  },
  tableCard: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    font: "400 13px/18px var(--font-sans)",
  },
  th: {
    textAlign: "left",
    padding: "10px 16px",
    background: "var(--paper-soft)",
    borderBottom: "1px solid var(--border-1)",
  },
  thButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    font: "500 12px/1 var(--font-sans)",
  },
  sortIcon: {
    fontSize: 14,
    lineHeight: 1,
  },
  tr: {
    cursor: "pointer",
    borderBottom: "1px solid var(--border-1)",
    outline: "none",
  },
  td: {
    padding: "12px 16px",
    verticalAlign: "middle",
    color: "var(--ink-700)",
  },
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  folderIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    background: "var(--brand-50)",
    color: "var(--teal-700)",
    fontSize: 16,
  },
  communityIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    background: "color-mix(in srgb, #7c5cfc 15%, transparent)",
    color: "#7c5cfc",
    fontSize: 16,
  },
  sharedIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    background: "color-mix(in srgb, #3b82f6 15%, transparent)",
    color: "#3b82f6",
    fontSize: 16,
  },
  communityTag: {
    marginLeft: 6,
    color: "#7c5cfc",
    fontWeight: 500,
  },
  sharedTag: {
    marginLeft: 6,
    color: "#3b82f6",
    fontWeight: 500,
  },
  deckName: {
    display: "block",
    font: "500 14px/18px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deckSub: {
    display: "block",
    marginTop: 2,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  progressCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 120,
  },
  progressTrack: {
    position: "relative",
    flex: 1,
    maxWidth: 120,
    height: 6,
    borderRadius: 999,
    background: "var(--ink-25)",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    background: "var(--teal-500)",
  },
  progressPct: {
    font: "500 12px/16px var(--font-sans)",
    color: "var(--ink-600)",
    minWidth: 34,
    textAlign: "right",
  },
  lastReviewed: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  showAll: {
    display: "flex",
    justifyContent: "center",
    padding: "12px 16px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  showAllPlain: {
    display: "flex",
    justifyContent: "center",
    marginTop: 16,
  },
  noMatches: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "48px 24px",
    textAlign: "center",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
  },
};
