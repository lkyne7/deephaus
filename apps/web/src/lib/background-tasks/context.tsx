"use client";

import type { GenerationJob, GenerationSettings } from "@deephaus/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as tus from "tus-js-client";
import {
  type AnkiImportResult,
  type EnqueueAnkiImportResponse,
  fetchAnkiImportJob,
  fetchJob,
  readJson,
  type GenerateResponse,
} from "@/lib/background-tasks/api";
import { ANKG_IMPORTS_BUCKET } from "@/lib/import/apkg-import-constants";
import { createClient } from "@/lib/supabase/client";

/** Files at or below this go straight through the request body (small + simple). */
const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Supabase resumable uploads require a fixed 6 MB chunk size. */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export type BackgroundTaskKind = "generation" | "anki-import";
export type BackgroundTaskPhase = "creating" | "uploading" | "generating" | "importing";
export type BackgroundTaskStatus = "running" | "ready" | "failed";

export type BackgroundTask = {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  phase: BackgroundTaskPhase;
  status: BackgroundTaskStatus;
  progress: number;
  projectId?: string;
  jobId?: string;
  cardsAdded?: number;
  error?: string | null;
  ankiResult?: AnkiImportResult;
  createdAt: number;
};

export type StartDeckGenerationInput = {
  projectId: string | null;
  deckName: string;
  settings: Partial<GenerationSettings>;
  chunkIndices?: number[];
  sourceMode: "text" | "document" | "video";
  videoInputMode?: "upload" | "youtube";
  text?: string;
  youtubeUrl?: string;
  previewRawText?: string | null;
  file?: File | null;
  onProjectCreated?: (projectId: string, deckName: string) => void;
};

type BackgroundTasksContextValue = {
  tasks: BackgroundTask[];
  activeCount: number;
  dismissTask: (taskId: string) => void;
  getTaskForProject: (projectId: string) => BackgroundTask | undefined;
  startDeckGeneration: (input: StartDeckGenerationInput) => string;
  startAnkiImport: (
    file: File,
    opts?: { deckName?: string; scheduling?: boolean },
  ) => string;
};

const BackgroundTasksContext = createContext<BackgroundTasksContextValue | null>(null);

function createTaskId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Resumable (TUS) upload straight to Supabase Storage. Unlike a single PUT, this
 * survives flaky connections and resumes interrupted multi-GB uploads instead of
 * restarting from zero.
 */
async function resumableUpload(
  file: File,
  storagePath: string,
  accessToken: string | undefined,
  onProgress: (fraction: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: accessToken ? `Bearer ${accessToken}` : "",
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_SIZE,
      metadata: {
        bucketName: ANKG_IMPORTS_BUCKET,
        objectName: storagePath,
        contentType: "application/octet-stream",
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onSuccess: () => resolve(),
    });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

function isTerminal(status: BackgroundTaskStatus) {
  return status === "ready" || status === "failed";
}

export function taskPhaseLabel(task: BackgroundTask) {
  if (task.status === "ready") {
    if (task.kind === "anki-import") return "Import complete";
    const count = task.cardsAdded ?? 0;
    return count > 0 ? `${count} card${count === 1 ? "" : "s"} ready` : "Cards ready";
  }
  if (task.status === "failed") {
    return task.error ?? "Failed";
  }
  if (task.phase === "creating") return "Creating deck…";
  if (task.phase === "uploading") return "Uploading…";
  if (task.phase === "importing") return "Importing…";
  return "Generating cards…";
}

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const updateTask = useCallback((taskId: string, patch: Partial<BackgroundTask>) => {
    setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  }, []);

  const appendTask = useCallback((task: BackgroundTask) => {
    setTasks((prev) => [task, ...prev]);
  }, []);

  const stopPolling = useCallback((taskId: string) => {
    const timer = pollTimers.current.get(taskId);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(taskId);
    }
  }, []);

  const finishGeneration = useCallback(
    (taskId: string, job: GenerationJob, cardsAdded: number) => {
      if (job.status === "failed") {
        updateTask(taskId, {
          status: "failed",
          error: job.error ?? "Generation failed",
        });
        return;
      }
      updateTask(taskId, {
        status: "ready",
        phase: "generating",
        progress: 100,
        jobId: job.id,
        cardsAdded,
        error: null,
      });
    },
    [updateTask],
  );

  const startPolling = useCallback(
    (taskId: string, jobId: string) => {
      stopPolling(taskId);
      const interval = setInterval(async () => {
        try {
          const job = await fetchJob(jobId);
          if (job.status === "ready") {
            stopPolling(taskId);
            finishGeneration(taskId, job, 0);
            return;
          }
          if (job.status === "failed") {
            stopPolling(taskId);
            updateTask(taskId, {
              status: "failed",
              error: job.error ?? "Generation failed",
            });
            return;
          }
          updateTask(taskId, {
            phase: "generating",
            progress: Math.max(40, job.progress ?? 0),
            jobId: job.id,
          });
        } catch {
          // Ignore transient poll errors.
        }
      }, 1500);
      pollTimers.current.set(taskId, interval);
    },
    [finishGeneration, stopPolling, updateTask],
  );

  const handleGenerationResponse = useCallback(
    (taskId: string, data: GenerateResponse) => {
      const cardsAdded = data.cards?.length ?? 0;
      if (data.job.status === "ready") {
        finishGeneration(taskId, data.job, cardsAdded);
        return;
      }
      if (data.job.status === "failed") {
        finishGeneration(taskId, data.job, cardsAdded);
        return;
      }
      updateTask(taskId, {
        phase: "generating",
        progress: Math.max(40, data.job.progress ?? 0),
        jobId: data.job.id,
      });
      startPolling(taskId, data.job.id);
    },
    [finishGeneration, startPolling, updateTask],
  );

  const dismissTask = useCallback(
    (taskId: string) => {
      stopPolling(taskId);
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
    },
    [stopPolling],
  );

  const getTaskForProject = useCallback(
    (projectId: string) =>
      tasks.find(
        (task) =>
          task.projectId === projectId &&
          task.kind === "generation" &&
          !isTerminal(task.status),
      ),
    [tasks],
  );

  const startDeckGeneration = useCallback(
    (input: StartDeckGenerationInput) => {
      const taskId = createTaskId();
      const title =
        input.file?.name ??
        (input.sourceMode === "video" && input.videoInputMode === "youtube"
          ? "YouTube import"
          : input.deckName.trim() || "Generating cards");

      appendTask({
        id: taskId,
        kind: "generation",
        title,
        phase: input.projectId ? "generating" : "creating",
        status: "running",
        progress: input.projectId ? 12 : 6,
        projectId: input.projectId ?? undefined,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          let activeProjectId = input.projectId;

          if (!activeProjectId) {
            updateTask(taskId, { phase: "creating", progress: 10 });
            const projectRes = await fetch("/api/projects", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: input.deckName.trim(),
                deck_name: input.deckName.trim(),
                settings: input.settings,
              }),
            });
            const project = await readJson<{ id: string }>(projectRes);
            activeProjectId = project.id;
            updateTask(taskId, { projectId: project.id, phase: "generating", progress: 18 });
            input.onProjectCreated?.(project.id, input.deckName.trim());
          }

          const payload = {
            settings: input.settings,
            chunk_indices: input.chunkIndices,
          };

          if (input.sourceMode === "text") {
            updateTask(taskId, { phase: "generating", progress: 30 });
            const res = await fetch("/api/generate/text", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                text: input.text?.trim(),
                ...payload,
              }),
            });
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(res));
            return;
          }

          if (input.sourceMode === "video" && input.videoInputMode === "youtube") {
            updateTask(taskId, { phase: "uploading", progress: 22 });
            const sourceRes = await fetch("/api/sources/youtube", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                url: input.youtubeUrl?.trim(),
                raw_text: input.previewRawText,
              }),
            });
            const sourceData = await readJson<{ id: string }>(sourceRes);

            updateTask(taskId, { phase: "generating", progress: 40 });
            const genRes = await fetch("/api/generate", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source_id: sourceData.id, ...payload }),
            });
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(genRes));
            return;
          }

          if (!input.file) {
            throw new Error("Choose a file to upload.");
          }

          updateTask(taskId, {
            phase: "uploading",
            progress: 20,
            title: input.file.name,
          });
          const form = new FormData();
          form.append("project_id", activeProjectId!);
          form.append("file", input.file, input.file.name);
          if (input.previewRawText) {
            form.append("raw_text", input.previewRawText);
          }
          const sourceRes = await fetch("/api/sources/file", {
            method: "POST",
            credentials: "include",
            body: form,
          });
          const sourceData = await readJson<{ id: string }>(sourceRes);

          updateTask(taskId, { phase: "generating", progress: 45 });
          const genRes = await fetch("/api/generate", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_id: sourceData.id, ...payload }),
          });
          handleGenerationResponse(taskId, await readJson<GenerateResponse>(genRes));
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Something went wrong",
          });
        }
      })();

      return taskId;
    },
    [appendTask, handleGenerationResponse, updateTask],
  );

  const startAnkiPolling = useCallback(
    (taskId: string, jobId: string) => {
      stopPolling(taskId);
      const interval = setInterval(async () => {
        try {
          const job = await fetchAnkiImportJob(jobId);
          if (job.status === "ready") {
            stopPolling(taskId);
            updateTask(taskId, {
              status: "ready",
              phase: "importing",
              progress: 100,
              ankiResult: job.result ?? undefined,
              error: null,
            });
            return;
          }
          if (job.status === "failed") {
            stopPolling(taskId);
            updateTask(taskId, { status: "failed", error: job.error ?? "Import failed" });
            return;
          }
          // Map server progress (0-100) into the post-upload 55-99 band.
          const clamped = Math.max(0, Math.min(100, job.progress ?? 0));
          const display = 55 + Math.round((clamped / 100) * 44);
          updateTask(taskId, { phase: "importing", progress: Math.max(56, display) });
        } catch {
          // Ignore transient poll errors.
        }
      }, 1500);
      pollTimers.current.set(taskId, interval);
    },
    [stopPolling, updateTask],
  );

  const startAnkiImport = useCallback(
    (file: File, opts?: { deckName?: string; scheduling?: boolean }) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "anki-import",
        title: file.name,
        phase: "importing",
        status: "running",
        progress: 12,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const deckName = opts?.deckName?.trim() || undefined;
          const scheduling = opts?.scheduling !== false;

          // Small packages go straight through the request body and import inline.
          if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
            updateTask(taskId, { phase: "importing", progress: 25 });
            const form = new FormData();
            form.append("file", file, file.name);
            if (deckName) form.append("deck_name", deckName);
            if (!scheduling) form.append("scheduling", "false");

            const res = await fetch("/api/import/anki", {
              method: "POST",
              credentials: "include",
              body: form,
            });
            const imported = await readJson<AnkiImportResult>(res);
            updateTask(taskId, {
              status: "ready",
              progress: 100,
              ankiResult: imported,
              error: null,
            });
            return;
          }

          // Large packages: resumable upload to storage, then an async durable
          // job the client polls (worker handles multi-GB; small ones run inline).
          updateTask(taskId, { phase: "uploading", progress: 6 });
          const prepareRes = await fetch("/api/import/anki/prepare", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name }),
          });
          const { storagePath } = await readJson<{ storagePath: string }>(prepareRes);

          const supabase = createClient();
          const {
            data: { session },
          } = await supabase.auth.getSession();

          await resumableUpload(file, storagePath, session?.access_token, (fraction) => {
            updateTask(taskId, {
              phase: "uploading",
              progress: Math.min(54, 6 + Math.round(fraction * 48)),
            });
          });

          updateTask(taskId, { phase: "importing", progress: 55 });
          const enqueueRes = await fetch("/api/import/anki/enqueue", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storage_path: storagePath,
              filename: file.name,
              file_size: file.size,
              deck_name: deckName,
              scheduling,
            }),
          });
          const { jobId } = await readJson<EnqueueAnkiImportResponse>(enqueueRes);
          updateTask(taskId, { jobId, phase: "importing", progress: 56 });
          startAnkiPolling(taskId, jobId);
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Import failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, updateTask, startAnkiPolling],
  );

  useEffect(
    () => () => {
      pollTimers.current.forEach((timer) => clearInterval(timer));
      pollTimers.current.clear();
    },
    [],
  );

  const value = useMemo(
    () => ({
      tasks,
      activeCount: tasks.filter((task) => task.status === "running").length,
      dismissTask,
      getTaskForProject,
      startDeckGeneration,
      startAnkiImport,
    }),
    [tasks, dismissTask, getTaskForProject, startDeckGeneration, startAnkiImport],
  );

  return (
    <BackgroundTasksContext.Provider value={value}>{children}</BackgroundTasksContext.Provider>
  );
}

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTasksContext);
  if (!ctx) {
    throw new Error("useBackgroundTasks requires BackgroundTasksProvider");
  }
  return ctx;
}
