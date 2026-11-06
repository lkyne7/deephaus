"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { getErrorMessage, isRecord, type CramForecast } from "./types";

/**
 * The forecast needs a saved snapshot of the selected cards, so the live
 * preview on /cram/new runs against one hidden draft. Its id stays tracked here
 * until the user saves or starts the plan. Anything still tracked is unsaved:
 * the list hides it, and the next visit deletes it if closing the page couldn't.
 */
const STORAGE_KEY = "deephaus.cramPreviewDrafts";
const PREVIEW_NAME = "Untitled cram plan";
const SETTINGS_DEBOUNCE_MS = 400;
const SELECTION_DEBOUNCE_MS = 800;

export type DraftSelection = { deck_ids: string[]; source_ids: string[]; tags: string[] };

export type DraftSettings = {
  deadline_at: string;
  deadline_timezone: string;
  deadline_has_time: boolean;
  target_retention: number;
  daily_minutes: number;
};

export type DraftPreview = {
  forecast: CramForecast | null;
  cardCount: number | null;
  itemCount: number | null;
};

const discarding = new Set<string>();

export function trackedPreviewDrafts(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeTracked(ids: string[]) {
  try {
    if (ids.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage errors: cleanup on leaving the page still runs.
  }
}

function track(id: string) {
  writeTracked([...new Set([...trackedPreviewDrafts(), id])]);
}

function untrack(id: string) {
  writeTracked(trackedPreviewDrafts().filter((tracked) => tracked !== id));
}

async function discardDraft(id: string) {
  if (discarding.has(id)) return;
  discarding.add(id);
  try {
    const response = await apiFetch(`/api/cram-plans/${id}`, { method: "DELETE", keepalive: true });
    // 404: already gone. 409: no longer a draft, so it isn't ours to delete.
    if (response.ok || response.status === 404 || response.status === 409) untrack(id);
  } catch {
    // Stays tracked, so the next visit retries.
  } finally {
    discarding.delete(id);
  }
}

export function sweepPreviewDrafts() {
  return Promise.all(trackedPreviewDrafts().map(discardDraft));
}

async function readPayload(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyError(getErrorMessage(payload, fallback)));
  return payload;
}

function friendlyError(message: string): string {
  return message.includes("did not resolve") ? "Nothing in this selection has cards yet." : message;
}

function toPreview(payload: unknown): DraftPreview {
  const root = isRecord(payload) ? payload : {};
  const plan = isRecord(root.plan) ? root.plan : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    forecast: isRecord(root.forecast) ? (root.forecast as CramForecast) : null,
    cardCount: count(plan.card_count),
    itemCount: count(plan.item_count),
  };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function useCramPreviewDraft({
  selection,
  selectionKey,
  settings,
}: {
  selection: DraftSelection;
  selectionKey: string;
  /** Null while the deadline is invalid. */
  settings: DraftSettings | null;
}) {
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftId = useRef<string | null>(null);
  const draftSelectionKey = useRef<string | null>(null);
  const closing = useRef(false);
  // Every write runs in order, so a slow create can't race the edit behind it.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const createDraft = useCallback(async (body: Record<string, unknown>, key: string) => {
    const payload = await readPayload(
      await apiFetch("/api/cram-plans", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
      "Could not create the cram plan.",
    );
    const plan = isRecord(payload) && isRecord(payload.plan) ? payload.plan : null;
    if (!plan || typeof plan.id !== "string") throw new Error("The plan was created without an id.");
    track(plan.id);
    draftId.current = plan.id;
    draftSelectionKey.current = key;
    return payload;
  }, []);

  /** Update the draft in place, or start a new one if it has gone. */
  const saveDraft = useCallback(
    async (body: Record<string, unknown>, nextSelection: DraftSelection, key: string) => {
      const id = draftId.current;
      if (id) {
        const selectionChanged = draftSelectionKey.current !== key;
        const response = await apiFetch(`/api/cram-plans/${id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(selectionChanged ? { ...body, ...nextSelection } : body),
        });
        if (response.status !== 404) {
          const payload = await readPayload(response, "Could not save the cram plan.");
          draftSelectionKey.current = key;
          return payload;
        }
        untrack(id);
        draftId.current = null;
      }
      return createDraft({ ...body, ...nextSelection }, key);
    },
    [createDraft],
  );

  const refresh = useCallback(
    async (nextSelection: DraftSelection, key: string, nextSettings: DraftSettings) => {
      if (closing.current) return;
      setError(null);
      try {
        const id = draftId.current;
        let payload: unknown = null;
        if (id && draftSelectionKey.current === key) {
          // Settings alone don't need a write: this endpoint forecasts overrides.
          const response = await apiFetch(`/api/cram-plans/${id}/preview`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({
              deadline_at: nextSettings.deadline_at,
              deadline_timezone: nextSettings.deadline_timezone,
              target_retention: nextSettings.target_retention,
              daily_minutes: nextSettings.daily_minutes,
            }),
          });
          if (response.status === 404) {
            untrack(id);
            draftId.current = null;
          } else {
            payload = await readPayload(response, "Could not update the preview.");
          }
        }
        payload ??= await saveDraft(
          { name: PREVIEW_NAME, ...nextSettings },
          nextSelection,
          key,
        );
        if (!closing.current) setPreview(toPreview(payload));
      } catch (caught) {
        if (!closing.current) {
          setError(caught instanceof Error ? caught.message : "Could not update the preview.");
        }
      } finally {
        if (!closing.current) setUpdating(false);
      }
    },
    [saveDraft],
  );

  const hasSelection =
    selection.deck_ids.length + selection.source_ids.length + selection.tags.length > 0;

  useEffect(() => {
    if (!hasSelection || !settings) {
      setPreview(null);
      setUpdating(false);
      setError(null);
      return;
    }
    setUpdating(true);
    const delay =
      draftSelectionKey.current === selectionKey ? SETTINGS_DEBOUNCE_MS : SELECTION_DEBOUNCE_MS;
    const timer = window.setTimeout(() => {
      void enqueue(() => refresh(selection, selectionKey, settings));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [enqueue, hasSelection, refresh, selection, selectionKey, settings]);

  useEffect(() => {
    closing.current = false;
    void sweepPreviewDrafts();

    function onPageHide() {
      const id = draftId.current;
      if (!id) return;
      draftId.current = null;
      draftSelectionKey.current = null;
      // apiFetch awaits the session first, which an unloading page may never
      // finish; cookies authenticate this request. A miss stays tracked.
      void fetch(`/api/cram-plans/${id}`, {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
      }).catch(() => undefined);
    }

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      closing.current = true;
      void queue.current.finally(() => {
        const id = draftId.current;
        draftId.current = null;
        draftSelectionKey.current = null;
        if (id) void discardDraft(id);
      });
    };
  }, []);

  /** Turn the preview into a real plan and return its id. */
  const commit = useCallback(
    async (name: string, start: boolean): Promise<string> => {
      if (!settings) throw new Error("Pick a deadline in the future.");
      closing.current = true;
      try {
        const id = await enqueue(async () => {
          await saveDraft({ name, ...settings }, selection, selectionKey);
          const planId = draftId.current;
          if (!planId) throw new Error("The plan was created without an id.");
          if (start) {
            await readPayload(
              await apiFetch(`/api/cram-plans/${planId}`, {
                method: "PATCH",
                headers: JSON_HEADERS,
                body: JSON.stringify({ action: "start" }),
              }),
              "The plan was saved, but could not be started.",
            );
          }
          return planId;
        });
        untrack(id);
        draftId.current = null;
        draftSelectionKey.current = null;
        return id;
      } catch (caught) {
        closing.current = false;
        setUpdating(false);
        throw caught;
      }
    },
    [enqueue, saveDraft, selection, selectionKey, settings],
  );

  return { preview, updating, error, commit };
}
