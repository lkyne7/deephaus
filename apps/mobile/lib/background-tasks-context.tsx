import type { AnkiImportResponse } from "@deephaus/api-client";
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
import { api } from "@/lib/api";

export type BackgroundTaskKind = "generation" | "anki-import";
export type BackgroundTaskPhase = "uploading" | "generating" | "importing";
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
  error?: string | null;
  ankiResult?: AnkiImportResponse;
  createdAt: number;
};

type BackgroundTasksContextValue = {
  tasks: BackgroundTask[];
  activeCount: number;
  dismissTask: (taskId: string) => void;
  getTaskForProject: (projectId: string) => BackgroundTask | undefined;
  startGenerationFromText: (
    projectId: string,
    text: string,
    settings?: Partial<GenerationSettings>,
  ) => string;
  startGenerationFromFile: (
    projectId: string,
    uri: string,
    filename: string,
    type: "pdf" | "any",
    settings?: Partial<GenerationSettings>,
  ) => string;
  startGenerationFromYoutube: (
    projectId: string,
    url: string,
    settings?: Partial<GenerationSettings>,
  ) => string;
  startAnkiImport: (
    uri: string,
    filename: string,
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

  const startPolling = useCallback(
    (taskId: string, jobId: string) => {
      stopPolling(taskId);
      const interval = setInterval(async () => {
        try {
          const job = await api.getJob(jobId);
          if (job.status === "ready") {
            stopPolling(taskId);
            updateTask(taskId, {
              status: "ready",
              phase: "generating",
              progress: 100,
              jobId: job.id,
              error: null,
            });
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
            progress: Math.max(15, job.progress ?? 0),
            jobId: job.id,
          });
        } catch {
          // Ignore transient poll errors.
        }
      }, 1500);
      pollTimers.current.set(taskId, interval);
    },
    [stopPolling, updateTask],
  );

  const handleGenerationJob = useCallback(
    (taskId: string, job: GenerationJob) => {
      if (job.status === "ready") {
        updateTask(taskId, {
          status: "ready",
          phase: "generating",
          progress: 100,
          jobId: job.id,
          error: null,
        });
        return;
      }
      if (job.status === "failed") {
        updateTask(taskId, {
          status: "failed",
          error: job.error ?? "Generation failed",
        });
        return;
      }
      updateTask(taskId, {
        phase: "generating",
        progress: Math.max(15, job.progress ?? 0),
        jobId: job.id,
      });
      startPolling(taskId, job.id);
    },
    [startPolling, updateTask],
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

  const startGenerationFromText = useCallback(
    (projectId: string, text: string, settings?: Partial<GenerationSettings>) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "generation",
        title: "Generating cards",
        phase: "generating",
        status: "running",
        progress: 8,
        projectId,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const result = await api.generateFromText(projectId, text, settings);
          handleGenerationJob(taskId, result.job);
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Generation failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, handleGenerationJob, updateTask],
  );

  const startGenerationFromFile = useCallback(
    (
      projectId: string,
      uri: string,
      filename: string,
      type: "pdf" | "any",
      settings?: Partial<GenerationSettings>,
    ) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "generation",
        title: filename,
        phase: "uploading",
        status: "running",
        progress: 10,
        projectId,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const response = await fetch(uri);
          const blob = await response.blob();
          updateTask(taskId, { progress: 25 });
          const sourceRow =
            type === "pdf"
              ? await api.uploadPdfSource(projectId, blob, filename)
              : await api.uploadFileSource(projectId, blob, filename);
          updateTask(taskId, { phase: "generating", progress: 35 });
          const { job } = await api.startGeneration(sourceRow.id, settings);
          handleGenerationJob(taskId, job);
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Upload failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, handleGenerationJob, updateTask],
  );

  const startGenerationFromYoutube = useCallback(
    (projectId: string, url: string, settings?: Partial<GenerationSettings>) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "generation",
        title: "YouTube import",
        phase: "uploading",
        status: "running",
        progress: 15,
        projectId,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const sourceRow = await api.addYoutubeSource(projectId, url);
          updateTask(taskId, { phase: "generating", progress: 30 });
          const { job } = await api.startGeneration(sourceRow.id, settings);
          handleGenerationJob(taskId, job);
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "YouTube import failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, handleGenerationJob, updateTask],
  );

  const startAnkiImport = useCallback(
    (uri: string, filename: string, opts?: { deckName?: string; scheduling?: boolean }) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "anki-import",
        title: filename,
        phase: "importing",
        status: "running",
        progress: 12,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const response = await fetch(uri);
          const blob = await response.blob();
          updateTask(taskId, { progress: 30 });
          const imported = await api.importAnki(blob, filename, opts);
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
      startGenerationFromText,
      startGenerationFromFile,
      startGenerationFromYoutube,
      startAnkiImport,
    }),
    [
      tasks,
      dismissTask,
      getTaskForProject,
      startGenerationFromText,
      startGenerationFromFile,
      startGenerationFromYoutube,
      startAnkiImport,
    ],
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

export function taskPhaseLabel(task: BackgroundTask) {
  if (task.status === "ready") {
    return task.kind === "anki-import" ? "Import complete" : "Cards ready";
  }
  if (task.status === "failed") {
    return task.error ?? "Failed";
  }
  if (task.phase === "uploading") return "Uploading…";
  if (task.phase === "importing") return "Importing…";
  return "Generating cards…";
}
