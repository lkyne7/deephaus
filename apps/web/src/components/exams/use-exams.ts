"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import type {
  CreateExamBody,
  ExamAction,
  ExamDetailDto,
  ExamInsightDto,
  ExamListResponse,
  ExamSelectorOptions,
  PreviewExamBody,
  UpdateExamBody,
} from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";
import { cacheKeys, examDetailKey } from "@/lib/client-cache/keys";
import { invalidateStudyCaches } from "@/lib/client-cache/prefetch";
import { getErrorMessage } from "./exam-helpers";

/** Standing moves with every review, so exams refetch sooner than the app default. */
const FRESH = { dedupingInterval: 2_000 } as const;

export function useExamList() {
  return useSWR<ExamListResponse>(cacheKeys.exams, FRESH);
}

export function useExamDetail(examId: string) {
  // Another exam's numbers must never stand in while this one loads.
  return useSWR<ExamDetailDto>(examDetailKey(examId), { ...FRESH, keepPreviousData: false });
}

export function useExamOptions() {
  return useSWR<ExamSelectorOptions>(cacheKeys.examOptions);
}

async function send<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(getErrorMessage(payload, fallback));
  return payload as T;
}

/** Put a fresh detail in the cache and let the list catch up. */
function remember(detail: ExamDetailDto): ExamDetailDto {
  void mutate(examDetailKey(detail.exam.id), detail, { revalidate: false });
  void mutate(cacheKeys.exams);
  return detail;
}

/** What an exam would ask for and reach. Nothing is saved. */
export function previewExam(body: PreviewExamBody, signal?: AbortSignal): Promise<ExamInsightDto> {
  return send<ExamInsightDto>(
    `${cacheKeys.exams}/preview`,
    { method: "POST", body: JSON.stringify(body), signal },
    "Could not work out a plan.",
  );
}

export async function createExam(body: CreateExamBody): Promise<ExamDetailDto> {
  return remember(
    await send<ExamDetailDto>(
      cacheKeys.exams,
      { method: "POST", body: JSON.stringify(body) },
      "Could not add the exam.",
    ),
  );
}

export async function updateExam(examId: string, body: UpdateExamBody): Promise<ExamDetailDto> {
  return remember(
    await send<ExamDetailDto>(
      examDetailKey(examId),
      { method: "PATCH", body: JSON.stringify(body) },
      "Could not save the exam.",
    ),
  );
}

export async function runExamAction(examId: string, action: ExamAction): Promise<ExamDetailDto> {
  const detail = remember(
    await send<ExamDetailDto>(
      examDetailKey(examId),
      { method: "PATCH", body: JSON.stringify({ action }) },
      "Could not update the exam.",
    ),
  );
  // Suspended cards leave every due count in the app.
  if (action === "suspend_cards") invalidateStudyCaches();
  return detail;
}

export async function deleteExam(examId: string): Promise<void> {
  await send<{ ok: boolean }>(examDetailKey(examId), { method: "DELETE" }, "Could not delete the exam.");
  void mutate(examDetailKey(examId), undefined, { revalidate: false });
  void mutate(cacheKeys.exams);
}

const PREVIEW_DEBOUNCE_MS = 350;

export type ExamPreviewState = {
  preview: ExamInsightDto | null;
  updating: boolean;
  error: string | null;
};

const NO_PREVIEW: ExamPreviewState = { preview: null, updating: false, error: null };

/**
 * A live plan for a form that hasn't been saved. Edits are debounced and a
 * request that has been overtaken is cancelled, so only the latest settings
 * ever land. The last answer stays on screen, dimmed, while the next loads.
 */
export function useExamPreview(body: PreviewExamBody | null): ExamPreviewState {
  const key = body ? JSON.stringify(body) : null;
  const [state, setState] = useState<ExamPreviewState>(NO_PREVIEW);

  useEffect(() => {
    if (!key) {
      setState(NO_PREVIEW);
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, updating: true, error: null }));
    const timer = window.setTimeout(() => {
      previewExam(JSON.parse(key) as PreviewExamBody, controller.signal).then(
        (preview) => {
          if (!controller.signal.aborted) setState({ preview, updating: false, error: null });
        },
        (caught: unknown) => {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            updating: false,
            error: caught instanceof Error ? caught.message : "Could not work out a plan.",
          }));
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  return state;
}
