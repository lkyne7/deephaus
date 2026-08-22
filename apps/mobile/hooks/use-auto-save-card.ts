import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const SAVED_DISPLAY_MS = 2000;

type Options = {
  cardId: string | null;
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
  const snapshotRef = useRef(snapshot);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  saveRef.current = save;
  snapshotRef.current = snapshot;

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

  const persist = useCallback(async (): Promise<void> => {
    if (!cardId || !enabled) return;
    if (inFlightRef.current) return inFlightRef.current;

    const operation = (async () => {
      try {
        while (snapshotRef.current !== savedSnapshotRef.current) {
          const targetSnapshot = snapshotRef.current;
          setStatus("saving");
          setError(null);
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          await saveRef.current();
          savedSnapshotRef.current = targetSnapshot;
        }
        setStatus("saved");
        savedTimerRef.current = setTimeout(() => {
          setStatus((current) => (current === "saved" ? "idle" : current));
        }, SAVED_DISPLAY_MS);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
        setStatus("error");
        throw err;
      }
    })();

    inFlightRef.current = operation;
    try {
      await operation;
    } finally {
      inFlightRef.current = null;
    }
  }, [cardId, enabled]);

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

  return { status, error, flush: persist };
}
