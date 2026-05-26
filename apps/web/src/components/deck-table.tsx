"use client";

import { useRouter } from "next/navigation";

export type DeckRow = {
  id: string;
  title: string;
  newCount: number;
  dueCount: number;
  lastReviewed: string | null;
};

export function DeckTable({ decks }: { decks: DeckRow[] }) {
  const router = useRouter();

  if (decks.length === 0) {
    return (
      <div style={s.empty}>
        <i className="ri-folder-line" style={{ fontSize: 40, color: "var(--ink-200)" }} />
        <div style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-700)" }}>
          You haven&apos;t created any decks
        </div>
        <div style={{ font: "400 14px/20px var(--font-sans)", color: "var(--fg-4)" }}>
          Paste any resource and let DeepHaus turn it into flashcards.
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Title</th>
            <th style={{ ...s.th, width: 90 }}>New</th>
            <th style={{ ...s.th, width: 90 }}>Due</th>
            <th style={{ ...s.th, width: 220 }}>Last reviewed</th>
            <th style={{ ...s.th, width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {decks.map((d) => (
            <tr
              key={d.id}
              style={s.tr}
              onClick={() => router.push(`/decks/${d.id}`)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td style={s.td}>
                <span style={s.titleCell}>
                  <i className="ri-folder-fill" style={{ color: "var(--ink-400)" }} />
                  {d.title}
                </span>
              </td>
              <td style={s.td}>
                <span className="chip chip-new">{d.newCount}</span>
              </td>
              <td style={s.td}>
                <span className="chip chip-due">{d.dueCount}</span>
              </td>
              <td style={s.td}>
                {d.lastReviewed ? (
                  <span style={s.muted}>
                    <i className="ri-time-line" />
                    {d.lastReviewed}
                  </span>
                ) : (
                  <span style={{ ...s.muted, color: "var(--fg-5)" }}>Has not been reviewed</span>
                )}
              </td>
              <td style={s.td}>
                <i className="ri-arrow-right-s-line" style={{ color: "var(--fg-4)" }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse", font: "400 14px/20px var(--font-sans)" },
  th: {
    textAlign: "left",
    font: "500 12px/1 var(--font-sans)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--fg-4)",
    padding: "14px 20px",
    background: "var(--paper-soft)",
    borderBottom: "1px solid var(--border-1)",
  },
  tr: { cursor: "pointer", transition: "background .12s" },
  td: { padding: "16px 20px", borderBottom: "1px solid var(--border-1)", color: "var(--ink-700)" },
  titleCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    font: "500 14px/20px var(--font-sans)",
  },
  muted: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "var(--ink-500)",
    font: "400 14px/20px var(--font-sans)",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "80px 24px",
    gap: 8,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    textAlign: "center",
  },
};
