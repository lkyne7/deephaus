import { supabase } from "@/lib/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/lib/auth-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { serializeSave } from "@deephaus/shared";

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
  key: string;
  userId: string;
  snapshot: string;
  save: (isCurrent: () => boolean) => Promise<void>;
};
const readDraft = (key: string) => AsyncStorage.getItem(key);
const writeDraft = (key: string, value: string) =>
  AsyncStorage.setItem(key, value);
const removeDraft = (key: string) => AsyncStorage.removeItem(key);

export function useAutoSaveCard({
  cardId,
  snapshot,
  enabled = true,
  debounceMs = 700,
  save,
  onRestore,
}: Options) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef<{ key: string; snapshot: string } | null>(null);
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
        } = await supabase.auth.getSession();
        if (session?.user.id !== edit.userId)
          throw new Error(
            "Sign back into the original account to save this draft.",
          );
        await edit.save(
          () =>
            latest.current?.key === edit.key &&
            latest.current.snapshot === edit.snapshot,
        );
        // Never remove a newer draft when an older request completes.
        await serializeSave(`storage:${edit.key}`, async () => {
          if ((await readDraft(edit.key)) === edit.snapshot)
            await removeDraft(edit.key);
        });
      });
      if (
        latest.current?.key === edit.key &&
        latest.current.snapshot === edit.snapshot
      ) {
        baseline.current = { key: edit.key, snapshot: edit.snapshot };
        setStatus("saved");
      }
    } catch (failure) {
      if (latest.current?.key === edit.key) {
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
      baseline.current.snapshot === edit.snapshot
    )
      return;
    await persist(edit);
  }, [persist]);

  useEffect(() => {
    if (!key || !enabled) return;
    const edit = { key, userId: userId!, snapshot, save };
    latest.current = edit;
    if (baseline.current?.key !== key) {
      baseline.current = { key, snapshot };
      setStatus("idle");
      setError(null);

      void readDraft(key)
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
    if (baseline.current.snapshot === snapshot) return;
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
  }, [key, enabled, snapshot, save, debounceMs, persist]);

  useEffect(
    () => () => {
      void flush().catch(() => undefined);
    },
    [flush, key],
  );
  return { status, error, flush };
}
