"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CardSaveStatus } from "@/components/card-save-status";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";
import type { DeckPublication } from "@/lib/community/types";

type Props = {
  projectId: string;
  deckName: string;
  publication: DeckPublication | null;
  onPublicationChange: (next: DeckPublication | null) => void;
  onClose: () => void;
};

export function subscriberLabel(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "subscriber" : "subscribers"}`;
}

async function failure(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error ?? fallback);
}

export function DeckSharingPanel({
  projectId,
  deckName,
  publication,
  onPublicationChange,
  onClose,
}: Props) {
  const router = useRouter();
  const [description, setDescription] = useState(publication?.description ?? "");
  const [savedDescription, setSavedDescription] = useState(publication?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AutoSaveStatus>("idle");
  const savedFlash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const published = Boolean(publication);

  useEffect(() => {
    return () => {
      if (savedFlash.current) clearTimeout(savedFlash.current);
    };
  }, []);

  // Published decks save the description as it's typed.
  useEffect(() => {
    if (!published || description.trim() === savedDescription.trim()) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        setSaveStatus("saving");
        setError(null);
        try {
          const res = await fetch("/api/community/publish", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, description: description.trim() || null }),
          });
          if (!res.ok) throw await failure(res, "Could not save description");
          const data = (await res.json()) as DeckPublication;
          onPublicationChange(data);
          setSavedDescription(data.description ?? "");
          setSaveStatus("saved");
          savedFlash.current = setTimeout(() => setSaveStatus("idle"), 1600);
        } catch (e) {
          setSaveStatus("idle");
          setError(e instanceof Error ? e.message : "Could not save description");
        }
      })();
    }, 450);
    return () => window.clearTimeout(handle);
  }, [description, savedDescription, published, projectId, onPublicationChange]);

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
      if (!res.ok) throw await failure(res, "Publish failed");
      const data = (await res.json()) as DeckPublication;
      onPublicationChange(data);
      setDescription(data.description ?? "");
      setSavedDescription(data.description ?? "");
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
      if (!res.ok) throw await failure(res, "Unpublish failed");
      onPublicationChange(null);
      setDescription("");
      setSavedDescription("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unpublish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="dh-panel dhd-panel" aria-label="Sharing">
      <div className="dh-panel__head">
        <b className="dhd-panel__title">Sharing</b>
        <span className="dh-spacer" />
        <button type="button" className="dhd-icon-btn" aria-label="Close" onClick={onClose}>
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body">
        <div className="dhd-panel-row dhd-panel-row--rule">
          <div style={{ flex: 1 }}>
            <div className="dhd-strong">{publication ? "Published" : "Private"}</div>
            <div className="dhd-muted">
              {publication
                ? "Republish after editing to push updates to followers."
                : "Share this deck so others can preview and subscribe."}
            </div>
          </div>
          {publication ? (
            <span className="dh-pill">{subscriberLabel(publication.subscriber_count)}</span>
          ) : null}
        </div>

        <label className="dhd-field">
          <span className="dhd-field__label">
            Description
            <small>{description.length}/500</small>
          </span>
          <textarea
            className="textarea dhd-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={5}
            placeholder="What is this deck about?"
          />
          <span className="dhd-help">Shown on Community when this deck is published.</span>
        </label>

        {error ? <div className="notice notice-error">{error}</div> : null}
      </div>

      <div className="dh-panel__foot dhd-panel__foot">
        <CardSaveStatus status={saveStatus} />
        <span className="dh-spacer" />
        {publication ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void unpublish()}>
            Unpublish
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void publish()}>
          {busy ? "Saving…" : publication ? "Republish updates" : "Publish to Community"}
        </button>
      </div>
    </aside>
  );
}
