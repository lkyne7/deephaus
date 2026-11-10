"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { CardSaveStatus } from "@/components/card-save-status";
import { ConfirmDialog } from "@/components/workbench/confirm-dialog";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";
import { swrFetcher } from "@/lib/client-cache/fetcher";
import { publishDeck, saveListing, unpublishDeck } from "@/lib/community/client";
import { countLabel, learnerLabel } from "@/lib/community/labels";
import { COMMUNITY_SUBJECTS } from "@/lib/community/subjects";
import type { DeckPublication } from "@/lib/community/types";
import "@/components/community/community.css";

const DESCRIPTION_MAX = 500;

type Props = {
  projectId: string;
  /** The deck's own name; a new listing starts with it as its title. */
  deckName: string;
  cardCount: number;
  publication: DeckPublication | null;
  onPublicationChange: (next: DeckPublication | null) => void;
  /** Leave the form without publishing (Community's panel has a Cancel). */
  onCancel?: () => void;
};

/**
 * The body and footer of a "publish this deck" panel, shared by the deck page
 * and Community. The listing has its own title because decks are often named
 * after their first source. Once published, the listing's words save as they
 * are typed; the cards only change on "Republish cards".
 */
export function PublishForm({
  projectId,
  deckName,
  cardCount,
  publication,
  onPublicationChange,
  onCancel,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const [title, setTitle] = useState(publication?.title ?? deckName);
  const [description, setDescription] = useState(publication?.description ?? "");
  const [subject, setSubject] = useState<string | null>(publication?.subject ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AutoSaveStatus>("idle");
  const [unpublishAsk, setUnpublishAsk] = useState(false);
  const saved = useRef({
    title: publication?.title ?? "",
    description: publication?.description ?? "",
    subject: publication?.subject ?? null,
  });
  const savedFlash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: profile } = useSWR<{ username?: string }>("/api/profile", swrFetcher, {
    revalidateOnFocus: false,
  });
  const published = Boolean(publication);

  useEffect(() => {
    return () => {
      if (savedFlash.current) clearTimeout(savedFlash.current);
    };
  }, []);

  // A published listing saves its words as they are typed.
  useEffect(() => {
    if (!published) return;
    const next = { title: title.trim(), description: description.trim(), subject };
    if (!next.title) return;
    if (
      next.title === saved.current.title.trim() &&
      next.description === saved.current.description.trim() &&
      next.subject === saved.current.subject
    ) {
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        setSaveStatus("saving");
        setError(null);
        try {
          const data = await saveListing(projectId, {
            title: next.title,
            description: next.description || null,
            subject: next.subject,
          });
          saved.current = {
            title: data.title,
            description: data.description ?? "",
            subject: data.subject ?? next.subject,
          };
          onPublicationChange(data);
          setSaveStatus("saved");
          savedFlash.current = setTimeout(() => setSaveStatus("idle"), 1600);
        } catch (e) {
          setSaveStatus("idle");
          setError(e instanceof Error ? e.message : "Could not save the listing");
        }
      })();
    }, 450);
    return () => window.clearTimeout(handle);
  }, [title, description, subject, published, projectId, onPublicationChange]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const data = await publishDeck(projectId, {
        title: title.trim() || deckName,
        description: description.trim() || null,
        subject,
      });
      saved.current = {
        title: data.title,
        description: data.description ?? "",
        subject: data.subject ?? subject,
      };
      onPublicationChange(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setError(null);
    try {
      await unpublishDeck(projectId);
      setUnpublishAsk(false);
      onPublicationChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unpublish failed");
    } finally {
      setBusy(false);
    }
  }

  const shownTitle = title.trim() || deckName;

  return (
    <>
      <div className="dh-panel__body dh-publish">
        <div className="dh-publish__state">
          <div>
            <div className="dh-publish__strong">{publication ? "Published" : "Private"}</div>
            <div className="dh-publish__muted">
              {publication
                ? "People who follow this deck get your changes when you republish the cards."
                : "Publish this deck so other people can try it and add it to their decks."}
            </div>
          </div>
          {publication ? <span className="dh-pill">{learnerLabel(publication.subscriber_count)}</span> : null}
        </div>

        <div className="dh-publish__field">
          <label className="dh-publish__label" htmlFor={titleId}>
            Title
          </label>
          <input
            id={titleId}
            className="input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          {shownTitle !== deckName ? (
            <span className="dh-publish__help">Shown in Community. Your own deck stays named {deckName}.</span>
          ) : (
            <span className="dh-publish__help">Shown in Community. Changing it leaves your own deck&apos;s name alone.</span>
          )}
        </div>

        <div className="dh-publish__field">
          <label className="dh-publish__label" htmlFor={descriptionId}>
            Description
            <small>
              {description.length}/{DESCRIPTION_MAX}
            </small>
          </label>
          <textarea
            id={descriptionId}
            className="textarea dh-publish__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="What is this deck about, and who is it for?"
          />
        </div>

        <div className="dh-publish__field">
          <span className="dh-publish__label">Subject</span>
          <div className="dh-publish__subjects" role="group" aria-label="Subject">
            {COMMUNITY_SUBJECTS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="dh-filter"
                aria-pressed={subject === option.value}
                onClick={() => setSubject(subject === option.value ? null : option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dh-publish__field">
          <span className="dh-publish__label dh-publish__label--quiet">How it will look</span>
          <div className="dh-publish__preview">
            <div className="dh-community-row__title">{shownTitle}</div>
            <div className="dh-community-row__desc">{description.trim() || "No description yet."}</div>
            <div className="dh-community-row__meta">
              {[
                countLabel(cardCount, "card"),
                publication ? learnerLabel(publication.subscriber_count) : null,
                profile?.username ? `@${profile.username}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>

        {profile?.username ? (
          <div className="dh-publish__as">
            Published as @{profile.username}
            <span className="dh-spacer" />
            <Link href="/settings">Change</Link>
          </div>
        ) : null}

        {error && !unpublishAsk ? (
          <div className="dh-note dh-community-error" role="alert">
            <i className="ri-error-warning-line" aria-hidden />
            {error}
          </div>
        ) : null}
      </div>

      <div className="dh-panel__foot dh-publish__foot">
        <CardSaveStatus status={saveStatus} />
        <span className="dh-spacer" />
        {publication ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setUnpublishAsk(true)}>
            Unpublish
          </button>
        ) : onCancel ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || cardCount === 0}
          onClick={() => void publish()}
        >
          {busy && !unpublishAsk ? "Saving…" : publication ? "Republish cards" : "Publish to Community"}
        </button>
      </div>

      <ConfirmDialog
        open={unpublishAsk}
        title="Remove this deck from Community?"
        confirmLabel="Unpublish"
        danger
        busy={busy}
        error={unpublishAsk ? error : null}
        onCancel={() => setUnpublishAsk(false)}
        onConfirm={() => void unpublish()}
      >
        The listing, its ratings and its link to people&apos;s copies are removed. Everyone who added the
        deck keeps their copy and their progress.
      </ConfirmDialog>
    </>
  );
}
