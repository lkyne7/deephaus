"use client";
import { useOptionalAppShellUser } from "@/lib/client-cache/user-context";
import { getOfflineUserId } from "@/lib/offline/identity";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { serializeSave } from "@deephaus/shared";
import { readDraft, writeDraft, removeDraft } from "@/lib/card-drafts";

export type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
type Options = {
  cardId: string | null;
  snapshot: string;
  enabled?: boolean;
  debounceMs?: number;
  save: (isCurrent: () => boolean) => Promise<void>;
  onRestore?: (snapshot: string) => void;
};
type Edit = {
  revision: number;
  key: string;
  userId: string;
  snapshot: string;
  save: (isCurrent: () => boolean) => Promise<void>;
};
export function useAutoSaveCard({
  cardId,
  snapshot,
  enabled = true,
  debounceMs = 700,
  save,
  onRestore,
}: Options) {
  const shellUser = useOptionalAppShellUser();
  const [userId, setUserId] = useState<string | null>(shellUser?.id ?? null);
  useEffect(() => {
    const client = createClient();
    let alive = true;
    void client.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user.id ?? getOfflineUserId());
    });
    const { data } = client.auth.onAuthStateChange((_event, session) =>
      setUserId(session?.user.id ?? getOfflineUserId()),
    );
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef<{ key: string; snapshot: string } | null>(null);
  // A return to the baseline still needs saving when an older edit is queued.
  const dirty = useRef(false);
  const revision = useRef(0);
  const latestRevisionByKey = useRef(new Map<string, number>());
  const latest = useRef<Edit | null>(null);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const key = userId && cardId ? `deephaus:draft:${userId}:${cardId}` : null;
  const persist = useCallback(async (edit: Edit) => {
    if (latest.current?.key === edit.key) {
      setStatus("saving");
      setError(null);
    }
    try {
      await serializeSave(edit.key, async () => {
        const {
          data: { session },
        } = await createClient().auth.getSession();
        if (session?.user.id !== edit.userId)
          throw new Error(
            "Sign back into the original account to save this draft.",
          );
        await edit.save(
          () =>
            latest.current?.key === edit.key &&
            latest.current.revision === edit.revision,
        );
        // Never remove a newer draft when an older request completes.
        await serializeSave(`storage:${edit.key}`, async () => {
          if (latestRevisionByKey.current.get(edit.key) === edit.revision && (await readDraft(edit.key)) === edit.snapshot)
            await removeDraft(edit.key);
        });
      });
      if (
        latest.current?.key === edit.key &&
        latest.current.revision === edit.revision
      ) {
        baseline.current = { key: edit.key, snapshot: edit.snapshot };
        dirty.current = false;
        setStatus("saved");
      }
    } catch (failure) {
      if (latest.current?.key === edit.key && latest.current.revision === edit.revision) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not save. Your draft is kept on this device.",
        );
        setStatus("error");
      }
      throw failure;
    }
  }, []);
  const flush = useCallback(async () => {
    const edit = latest.current;
    if (
      !edit ||
      baseline.current?.key !== edit.key ||
      (baseline.current.snapshot === edit.snapshot && !dirty.current)
    )
      return;
    await persist(edit);
  }, [persist]);

  useEffect(() => {
    if (!key || !enabled) return;
    if (latest.current?.key !== key || latest.current.snapshot !== snapshot) revision.current++;
    const edit = { key, userId: userId!, snapshot, save, revision: revision.current };
    latestRevisionByKey.current.set(key, edit.revision);
    latest.current = edit;
    if (baseline.current?.key !== key) {
      baseline.current = { key, snapshot };
      dirty.current = false;
      setStatus("idle");
      setError(null);

      void serializeSave(`storage:${key}`, () => readDraft(key))
        .then((stored) => {
          if (
            latest.current?.key !== key ||
            !stored ||
            stored === snapshot ||
            latest.current?.snapshot !== snapshot
          )
            return;
          if (restoreRef.current) {
            restoreRef.current(stored);
            setStatus("pending");
          } else {
            setError("An unsaved draft is available on this device.");
            setStatus("error");
          }
        })
        .catch(() => {
          setError(
            "Device storage is unavailable. Keep this editor open until saved.",
          );
          setStatus("error");
        });
      return;
    }
    if (baseline.current.snapshot === snapshot && !dirty.current) return;
    dirty.current = true;
    setStatus("pending");
    // Persist before the debounce/network request so closing the process doesn't lose edits.
    void serializeSave(`storage:${key}`, () => writeDraft(key, snapshot)).catch(
      () => {
        setError("Device storage is full. Keep this editor open until saved.");
        setStatus("error");
      },
    );
    const timer = setTimeout(() => {
      void persist(edit).catch(() => undefined);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [key, userId, enabled, snapshot, save, debounceMs, persist]);

  useEffect(
    () => () => {
      void flush().catch(() => undefined);
    },
    [flush, key],
  );
  return { status, error, flush };
}
