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
  const cardIdRef = useRef<string | null>(null);
  const saveRef = useRef(save);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  saveRef.current = save;

  useEffect(() => {
    if (!cardId) {
      savedSnapshotRef.current = null;
      cardIdRef.current = null;
      setStatus("idle");
      setError(null);
      return;
    }
    if (cardIdRef.current !== cardId) {
      cardIdRef.current = cardId;
      savedSnapshotRef.current = null;
      setStatus("idle");
      setError(null);
    }
  }, [cardId]);

  const persist = useCallback(async () => {
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

  useEffect(() => {
    if (!cardId || !enabled) return;

    if (savedSnapshotRef.current === null) {
      savedSnapshotRef.current = snapshot;
      return;
    }

    if (snapshot === savedSnapshotRef.current) return;

    setStatus("pending");
    const timer = setTimeout(() => {
      void persist();
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [cardId, enabled, debounceMs, snapshot, persist]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const id = cardId;
    const currentSnapshot = snapshot;
    return () => {
      if (!id || !enabled) return;
      if (
        savedSnapshotRef.current !== null &&
        currentSnapshot !== savedSnapshotRef.current
      ) {
        void saveRef.current()
          .then(() => {
            savedSnapshotRef.current = currentSnapshot;
          })
          .catch(() => {});
      }
    };
  }, [cardId, enabled, snapshot]);

  return { status, error, flush: persist };
}
