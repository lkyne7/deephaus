"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Grade = "again" | "hard" | "good" | "easy";

const GRADES: Array<{
  id: Grade;
  rating: 1 | 2 | 3 | 4;
  label: string;
  color: string;
  bg: string;
}> = [
  { id: "again", rating: 1, label: "Again", color: "var(--grade-again)", bg: "var(--grade-again-bg)" },
  { id: "hard", rating: 2, label: "Hard", color: "var(--grade-hard)", bg: "var(--grade-hard-bg)" },
  { id: "good", rating: 3, label: "Good", color: "var(--grade-good)", bg: "var(--grade-good-bg)" },
  { id: "easy", rating: 4, label: "Easy", color: "var(--grade-easy)", bg: "var(--grade-easy-bg)" },
];

interface ReviewCard {
  id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  state: number;
  due: string;
  reps: number;
  lapses: number;
  is_new: boolean;
  intervals: Record<Grade, string>;
}

interface QueueCounts {
  due: number;
  new: number;
  learning: number;
  total: number;
}

interface QueueResponse {
  deck: { id: string; name: string };
  cards: ReviewCard[];
  counts: QueueCounts;
}

interface SessionStats {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

function ClozeFront({ text }: { text: string }) {
  const parts = text.split(/(\{\{c\d+::[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{c\d+::([^}]+)\}\}$/.exec(part);
        if (m) {
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                padding: "2px 12px",
                margin: "0 2px",
                borderRadius: 9999,
                background: "var(--ink-100)",
                color: "var(--ink-400)",
                border: "1px dashed var(--ink-200)",
              }}
            >
              [&hellip;]
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function ClozeBack({ text }: { text: string }) {
  const parts = text.split(/(\{\{c\d+::[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{c\d+::([^}]+)\}\}$/.exec(part);
        if (m) {
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                padding: "2px 12px",
                margin: "0 2px",
                borderRadius: 9999,
                background: "var(--teal-100)",
                color: "var(--ink-900)",
                border: "1px solid var(--teal-400)",
              }}
            >
              {m[1]}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function StudyMode({ deckId, deckTitle }: { deckId: string; deckTitle: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [counts, setCounts] = useState<QueueCounts>({ due: 0, new: 0, learning: 0, total: 0 });
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${deckId}/review`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as QueueResponse;
      setQueue(data.cards);
      setCounts(data.counts);
      setIdx(0);
      setRevealed(false);
      setDone(data.cards.length === 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const card = queue[idx];

  const grade = useCallback(
    async (g: Grade) => {
      if (!card || submitting) return;
      setSubmitting(true);
      try {
        const gradeMeta = GRADES.find((x) => x.id === g)!;
        const res = await fetch(`/api/cards/${card.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating: gradeMeta.rating }),
        });
        if (!res.ok) {
          throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        }
        setStats((s) => ({ ...s, [g]: s[g] + 1 }));
        setRevealed(false);
        if (idx + 1 >= queue.length) {
          setDone(true);
        } else {
          setIdx(idx + 1);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit grade");
      } finally {
        setSubmitting(false);
      }
    },
    [card, idx, queue.length, submitting],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (loading || done) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        void grade(GRADES[Number(e.key) - 1].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, grade, loading, done]);

  if (loading) {
    return (
      <div style={s.page}>
        <div className="app-chrome-bar" style={{ ...s.header, justifyContent: "space-between" }}>
          <Link href={`/decks/${deckId}`} style={s.back}>
            <i className="ri-arrow-left-s-line" />
            {deckTitle}
          </Link>
        </div>
        <div style={s.wrap}>
          <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
            <i className="ri-loader-4-line" style={{ fontSize: 32, color: "var(--ink-300)" }} />
            <p style={{ marginTop: 12, color: "var(--fg-3)" }}>Loading review queue…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && queue.length === 0) {
    return (
      <div style={s.page}>
        <div className="app-chrome-bar" style={{ ...s.header, justifyContent: "space-between" }}>
          <Link href={`/decks/${deckId}`} style={s.back}>
            <i className="ri-arrow-left-s-line" />
            {deckTitle}
          </Link>
        </div>
        <div style={s.wrap}>
          <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
            <i className="ri-error-warning-line" style={{ fontSize: 32, color: "var(--grade-again)" }} />
            <p style={{ marginTop: 12, color: "var(--fg-3)" }}>{error}</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void loadQueue()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    const total = stats.again + stats.hard + stats.good + stats.easy;
    return (
      <div style={s.page}>
        <div className="app-chrome-bar" style={{ ...s.header, justifyContent: "space-between" }}>
          <Link href={`/decks/${deckId}`} style={s.back}>
            <i className="ri-arrow-left-s-line" />
            {deckTitle}
          </Link>
        </div>
        <div style={s.wrap}>
          <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
            <i className="ri-check-double-line" style={{ fontSize: 48, color: "var(--grade-easy)" }} />
            <h2 className="display-xs" style={{ marginTop: 16 }}>
              {total === 0 ? "All caught up" : "Session Complete"}
            </h2>
            <p style={{ color: "var(--fg-3)", marginTop: 8 }}>
              {total === 0
                ? "No cards are due for review right now."
                : `You reviewed ${total} card${total === 1 ? "" : "s"}.`}
            </p>
            {total > 0 && (
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
                {GRADES.map((g) => (
                  <div
                    key={g.id}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 12,
                      background: g.bg,
                      color: g.color,
                      font: "500 13px/16px var(--font-sans)",
                    }}
                  >
                    {g.label}: {stats[g.id]}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 32 }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setStats({ again: 0, hard: 0, good: 0, easy: 0 });
                  void loadQueue();
                }}
              >
                {total === 0 ? "Refresh" : "Study More"}
              </button>
              <button className="btn btn-primary" onClick={() => router.push(`/decks/${deckId}`)}>
                Back to Deck
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div className="app-chrome-bar" style={{ ...s.header, justifyContent: "space-between" }}>
        <Link href={`/decks/${deckId}`} style={s.back}>
          <i className="ri-arrow-left-s-line" />
          {deckTitle}
        </Link>
        <div style={{ flex: 1 }} />
        <Link href={`/decks/${deckId}`} className="btn btn-ghost btn-sm">
          <i className="ri-pencil-line" />
          Edit Deck
        </Link>
      </div>

      <div style={s.wrap}>
        <div style={s.cardChrome}>
          <div style={s.chipRow}>
            <span className="chip chip-due">
              <span className="chip-dot" />
              Card {idx + 1} of {queue.length}
            </span>
            {card.is_new ? (
              <span className="chip chip-new">
                <span className="chip-dot" />
                New
              </span>
            ) : card.state === 1 || card.state === 3 ? (
              <span className="chip chip-due">
                <span className="chip-dot" />
                Learning
              </span>
            ) : (
              <span className="chip chip-new">
                <span className="chip-dot" />
                Review
              </span>
            )}
          </div>

          <div style={s.face}>
            <div style={s.front}>
              {card.type === "cloze" && card.cloze_text ? (
                revealed ? (
                  <ClozeBack text={card.cloze_text} />
                ) : (
                  <ClozeFront text={card.cloze_text} />
                )
              ) : (
                card.front
              )}
            </div>
            {revealed && card.type === "basic" && (
              <>
                <div style={s.divider} />
                <div style={s.back2}>{card.back}</div>
              </>
            )}
            {revealed && card.extra && (
              <div style={{ color: "var(--fg-4)", font: "400 14px/22px var(--font-sans)", marginTop: 8 }}>
                {card.extra}
              </div>
            )}
          </div>

          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${((idx + (revealed ? 1 : 0)) / queue.length) * 100}%` }} />
          </div>
        </div>

        {revealed ? (
          <div style={s.gradeBar}>
            {GRADES.map((g, i) => (
              <button
                key={g.id}
                onClick={() => void grade(g.id)}
                disabled={submitting}
                style={{
                  ...s.gradeBtn,
                  borderRight: i === GRADES.length - 1 ? 0 : "1px solid var(--border-1)",
                  cursor: submitting ? "wait" : "pointer",
                  opacity: submitting ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!submitting) e.currentTarget.style.background = g.bg;
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--white)")}
              >
                <div style={{ font: "600 14px/1 var(--font-sans)", color: g.color }}>{g.label}</div>
                <div style={{ font: "400 11px/1 var(--font-sans)", color: "var(--fg-4)", marginTop: 6 }}>
                  {card.intervals[g.id]}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => setRevealed(true)} style={s.showBtn}>
            Show Answer
            <span style={{ font: "400 12px/1 var(--font-sans)", color: "var(--ink-300)", marginLeft: 12 }}>Space</span>
          </button>
        )}

        {(counts.due > 0 || counts.new > 0) && (
          <div style={s.counterRow}>
            <span style={{ color: "var(--grade-again)" }}>{counts.learning} learning</span>
            <span style={{ color: "var(--grade-hard)" }}>{counts.due - counts.learning} due</span>
            <span style={{ color: "var(--teal-500)" }}>{counts.new} new</span>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--grade-again-bg)",
              color: "var(--grade-again)",
              font: "500 13px/18px var(--font-sans)",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { flex: 1, display: "flex", flexDirection: "column", background: "var(--paper)", minHeight: "100vh" },
  header: {
    gap: 12,
    padding: "0 32px",
  },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "var(--ink-900)",
    font: "500 15px/20px var(--font-sans)",
  },
  wrap: { flex: 1, padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 880, width: "100%", margin: "0 auto" },
  cardChrome: {
    background: "var(--white)",
    borderRadius: 16,
    border: "1px solid var(--border-2)",
    padding: "24px 32px",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 460,
    position: "relative",
    overflow: "hidden",
  },
  chipRow: { display: "flex", justifyContent: "space-between" },
  face: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "40px 24px",
    gap: 24,
  },
  front: { font: "500 24px/36px var(--font-sans)", color: "var(--ink-700)", maxWidth: 720 },
  divider: { width: "60%", height: 1, background: "var(--border-1)" },
  back2: { font: "400 18px/28px var(--font-sans)", color: "var(--ink-500)", maxWidth: 720 },
  progressBar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "var(--ink-50)" },
  progressFill: { height: 3, background: "var(--teal-500)", transition: "width .25s" },
  showBtn: {
    background: "var(--ink-700)",
    color: "var(--white)",
    border: 0,
    padding: "16px 20px",
    borderRadius: 12,
    font: "500 16px/20px var(--font-sans)",
    cursor: "pointer",
    boxShadow: "var(--shadow-sm)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  gradeBar: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    background: "var(--white)",
    borderRadius: 12,
    border: "1px solid var(--border-2)",
    overflow: "hidden",
  },
  gradeBtn: {
    padding: "16px 0",
    textAlign: "center",
    border: 0,
    background: "var(--white)",
    transition: "background .15s",
  },
  counterRow: {
    display: "flex",
    justifyContent: "center",
    gap: 20,
    font: "500 13px/16px var(--font-sans)",
    color: "var(--fg-3)",
    paddingTop: 8,
  },
};
