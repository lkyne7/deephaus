"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import type { DeckPublication } from "@/lib/community/types";

type Props = {
  projectId: string;
  deckName: string;
  cardCount: number;
  initialPublication: DeckPublication | null;
};

export function CommunityPublish({
  projectId,
  deckName,
  cardCount,
  initialPublication,
}: Props) {
  const router = useRouter();
  const [publication, setPublication] = useState(initialPublication);
  const [description, setDescription] = useState(initialPublication?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/community/publish", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          title: deckName,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Publish failed");
      }
      const data = (await res.json()) as DeckPublication;
      setPublication(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!confirm("Remove this deck from Community? Existing subscribers keep their copies.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/community/publish?project_id=${projectId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unpublish failed");
      }
      setPublication(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unpublish failed");
    } finally {
      setBusy(false);
    }
  }

  if (cardCount === 0) return null;

  return (
    <FadeIn>
      <div className="surface" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)", margin: 0 }}>
          <i className="ri-community-line" style={{ marginRight: 8, color: "var(--teal-700)" }} />
          Community
        </h3>
        {publication && (
          <span className="chip chip-neutral">
            {publication.subscriber_count} subscriber{publication.subscriber_count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p style={{ font: "400 13px/20px var(--font-sans)", color: "var(--fg-3)", margin: "0 0 12px" }}>
        {publication
          ? "Your deck is published. Republish after editing to push updates to followers."
          : "Share this deck so others can preview and subscribe."}
      </p>

      <label
        style={{
          display: "block",
          font: "500 13px/20px var(--font-sans)",
          color: "var(--ink-700)",
          marginBottom: 6,
        }}
      >
        Description (optional)
      </label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="What is this deck about?"
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border-1)",
          font: "400 14px/20px var(--font-sans)",
          resize: "vertical",
          marginBottom: 12,
        }}
      />

      {error && (
        <div className="notice notice-error">{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={publish} disabled={busy}>
          {busy ? "Saving…" : publication ? "Republish updates" : "Publish to Community"}
        </button>
        {publication && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={unpublish} disabled={busy}>
            Unpublish
          </button>
        )}
      </div>
      </div>
    </FadeIn>
  );
}
