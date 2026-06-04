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
import {
  type AnkiImportResult,
  fetchJob,
  readJson,
  type GenerateResponse,
} from "@/lib/background-tasks/api";
import { ANKG_IMPORTS_BUCKET } from "@/lib/import/apkg-import-constants";
import { createClient } from "@/lib/supabase/client";

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
          const useStorageUpload = file.size > 4 * 1024 * 1024;
          let res: Response;

          if (useStorageUpload) {
            updateTask(taskId, { phase: "uploading", progress: 8 });
            const prepareRes = await fetch("/api/import/anki/prepare", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: file.name }),
            });
            const { storagePath } = await readJson<{ storagePath: string }>(prepareRes);

            const supabase = createClient();
            const { error: uploadError } = await supabase.storage
              .from(ANKG_IMPORTS_BUCKET)
              .upload(storagePath, file, {
                contentType: "application/octet-stream",
                upsert: true,
              });
            if (uploadError) {
              throw new Error(uploadError.message);
            }

            updateTask(taskId, { phase: "importing", progress: 35 });
            res = await fetch("/api/import/anki", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storage_path: storagePath,
                deck_name: opts?.deckName?.trim() || undefined,
                scheduling: opts?.scheduling !== false,
              }),
            });
          } else {
            updateTask(taskId, { progress: 25 });
            const form = new FormData();
            form.append("file", file, file.name);
            if (opts?.deckName?.trim()) form.append("deck_name", opts.deckName.trim());
            if (opts?.scheduling === false) form.append("scheduling", "false");

            res = await fetch("/api/import/anki", {
              method: "POST",
              credentials: "include",
              body: form,
            });
          }

          const imported = await readJson<AnkiImportResult>(res);
          updateTask(taskId, {
            status: "ready",
            progress: 100,
            ankiResult: imported,
            error: null,
          });
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Import failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, updateTask],
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
