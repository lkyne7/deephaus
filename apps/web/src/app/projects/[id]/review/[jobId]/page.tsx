"use client";

import { NavBar } from "@/components/auth-panel";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { DraftCard } from "@sluggo/shared";

export default function ReviewPage() {
  const params = useParams<{ id: string; jobId: string }>();
  const jobId = params.jobId;
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    void fetch(`/api/cards?job_id=${jobId}`)
      .then((r) => r.json())
      .then(setCards)
      .catch(() => setError("Failed to load cards"));
  }, [jobId]);

  async function updateCard(card: DraftCard, updates: Partial<DraftCard>) {
    const res = await fetch(`/api/cards/${card.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...updates } : c)));
    }
  }

  async function deleteCard(id: string) {
    const res = await fetch(`/api/cards/${id}`, { method: "DELETE" });
    if (res.ok) setCards((prev) => prev.filter((c) => c.id !== id));
  }

  async function exportDeck() {
    if (!jobId) return;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id, job_id: jobId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sluggo-deck.apkg";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <NavBar />
      <main className="container stack">
        <div className="row">
          <Link href={`/projects/${params.id}`} className="muted">
            ← Back to project
          </Link>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Review cards ({cards.length})</h1>
          <button className="btn btn-primary" disabled={exporting || cards.length === 0} onClick={() => void exportDeck()}>
            {exporting ? "Exporting…" : "Download .apkg"}
          </button>
        </div>

        {error && <p className="muted">{error}</p>}

        <div className="stack">
          {cards.map((card) => (
            <article key={card.id} className="flashcard-item stack">
              <header>
                <span className="badge">{card.type}</span>
                <button className="btn btn-danger" onClick={() => void deleteCard(card.id)}>
                  Delete
                </button>
              </header>
              {card.type === "basic" ? (
                <>
                  <label className="label">Front</label>
                  <textarea
                    className="textarea"
                    value={card.front ?? ""}
                    onChange={(e) =>
                      setCards((prev) =>
                        prev.map((c) => (c.id === card.id ? { ...c, front: e.target.value } : c)),
                      )
                    }
                    onBlur={() => void updateCard(card, { front: card.front })}
                  />
                  <label className="label">Back</label>
                  <textarea
                    className="textarea"
                    value={card.back ?? ""}
                    onChange={(e) =>
                      setCards((prev) =>
                        prev.map((c) => (c.id === card.id ? { ...c, back: e.target.value } : c)),
                      )
                    }
                    onBlur={() => void updateCard(card, { back: card.back })}
                  />
                </>
              ) : (
                <>
                  <label className="label">Cloze text</label>
                  <textarea
                    className="textarea"
                    value={card.cloze_text ?? ""}
                    onChange={(e) =>
                      setCards((prev) =>
                        prev.map((c) =>
                          c.id === card.id ? { ...c, cloze_text: e.target.value } : c,
                        ),
                      )
                    }
                    onBlur={() => void updateCard(card, { cloze_text: card.cloze_text })}
                  />
                </>
              )}
              <label className="label">Extra</label>
              <input
                className="input"
                value={card.extra ?? ""}
                onChange={(e) =>
                  setCards((prev) =>
                    prev.map((c) => (c.id === card.id ? { ...c, extra: e.target.value } : c)),
                  )
                }
                onBlur={() => void updateCard(card, { extra: card.extra })}
              />
              <p className="muted">Tags: {card.tags.join(", ") || "none"}</p>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
