"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const SAVED_DISPLAY_MS = 2000;

type Options = {
  cardId: string | null;
  /** Serialized draft — when this changes and differs from last saved, auto-save runs. */
  snapshot: string;
  enabled?: boolean;
  debounceMs?: number;
  save: () => Promise<void>;
};

type LiveState = {
  cardId: string | null;
  snapshot: string;
  save: () => Promise<void>;
  enabled: boolean;
};

export function useAutoSaveCard({
  cardId,
  snapshot,
  enabled = true,
  debounceMs = 700,
  save,
}: Options) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const savedSnapshotRef = useRef<string | null>(null);
  const saveRef = useRef(save);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest committed values for the active card. Updated inside an effect (after
  // render) so that when the card switches, we can still read the *previous*
  // card's snapshot/save and flush its pending edits to the correct card.
  const liveRef = useRef<LiveState>({ cardId, snapshot, save, enabled });

  saveRef.current = save;

  const flush = useCallback(async () => {
    if (!cardId || !enabled) return;
    if (snapshot === savedSnapshotRef.current) return;

    setStatus("saving");
    setError(null);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    try {
      await saveRef.current();
      savedSnapshotRef.current = snapshot;
      setStatus("saved");
      savedTimerRef.current = setTimeout(() => {
        setStatus((current) => (current === "saved" ? "idle" : current));
      }, SAVED_DISPLAY_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setStatus("error");
    }
  }, [cardId, enabled, snapshot]);

  // Track the live snapshot of the active card, and flush the previous card's
  // unsaved edits when switching cards. Runs every render (no deps) so the
  // tracked snapshot stays current; the card-switch branch only runs on change.
  useEffect(() => {
    const prev = liveRef.current;
    if (prev.cardId !== cardId) {
      if (
        prev.cardId &&
        prev.enabled &&
        savedSnapshotRef.current !== null &&
        prev.snapshot !== savedSnapshotRef.current
      ) {
        void prev.save().catch(() => {});
      }
      // Defer establishing the new card's baseline to the debounced effect, which
      // only runs once editing is enabled and the snapshot has settled. This
      // avoids a spurious write-back when the card id updates a render before the
      // draft does.
      savedSnapshotRef.current = null;
      setStatus("idle");
      setError(null);
    }
    liveRef.current = { cardId, snapshot, save, enabled };
  });

  // Debounced auto-save while staying on the same card.
  useEffect(() => {
    if (!cardId || !enabled) return;
    if (savedSnapshotRef.current === null) {
      savedSnapshotRef.current = snapshot;
      return;
    }
    if (snapshot === savedSnapshotRef.current) return;

    setStatus("pending");
    const timer = setTimeout(() => {
      void flush();
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [cardId, enabled, debounceMs, snapshot, flush]);

  // Flush any pending edits on unmount.
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      const last = liveRef.current;
      if (
        last.cardId &&
        last.enabled &&
        savedSnapshotRef.current !== null &&
        last.snapshot !== savedSnapshotRef.current
      ) {
        void last.save().catch(() => {});
      }
    };
  }, []);

  return { status, error, flush };
}
