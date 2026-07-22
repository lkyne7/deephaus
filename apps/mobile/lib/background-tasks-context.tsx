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
export type BackgroundTaskPhase =
  | "uploading"
  | "generating"
  | "importing"
  | "chunking"
  | "extracting";
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
  ankiResult?: AnkiImportResponse;
  createdAt: number;
  progressStartedAt?: number;
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
  startGenerationFromWebsite: (
    projectId: string,
    url: string,
    settings?: Partial<GenerationSettings>,
  ) => string;
  startGenerationFromTopic: (
    projectId: string,
    topic: string,
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
      const tick = async () => {
        try {
          const job = (await api.getJob(jobId)) as GenerationJob & { card_count?: number };
          if (job.status === "ready") {
            stopPolling(taskId);
            updateTask(taskId, {
              status: "ready",
              phase: "generating",
              progress: 100,
              jobId: job.id,
              cardsAdded: job.card_count ?? 0,
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
          const progress = Math.min(99, Math.max(0, job.progress ?? 0));
          const phase: BackgroundTaskPhase =
            job.status === "extracting" || job.status === "uploaded"
              ? "extracting"
              : job.status === "chunking"
                ? "chunking"
                : "generating";
          setTasks((prev) =>
            prev.map((task) => {
              if (task.id !== taskId) return task;
              return {
                ...task,
                phase,
                progress,
                jobId: job.id,
                progressStartedAt:
                  task.progressStartedAt ?? (progress >= 10 ? Date.now() : undefined),
              };
            }),
          );
        } catch {
          // Ignore transient poll errors.
        }
      };
      void tick();
      const interval = setInterval(() => void tick(), 1000);
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
        progress: Math.min(99, Math.max(8, job.progress ?? 8)),
        jobId: job.id,
        progressStartedAt: Date.now(),
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
          updateTask(taskId, { progress: 25, phase: "generating" });
          const result =
            type === "pdf"
              ? await api.uploadAndGeneratePdfSource(projectId, blob, filename, settings)
              : await api.uploadAndGenerateFileSource(projectId, blob, filename, settings);
          handleGenerationJob(taskId, result.job);
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
          const result = await api.addYoutubeSource(projectId, url, settings);
          updateTask(taskId, { phase: "generating", progress: 30 });
          handleGenerationJob(taskId, result.job);
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

  const startGenerationFromWebsite = useCallback(
    (projectId: string, url: string, settings?: Partial<GenerationSettings>) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "generation",
        title: "Website import",
        phase: "uploading",
        status: "running",
        progress: 15,
        projectId,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const result = await api.addWebsiteSource(projectId, url, settings);
          updateTask(taskId, { phase: "generating", progress: 30 });
          handleGenerationJob(taskId, result.job);
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Website import failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, handleGenerationJob, updateTask],
  );

  const startGenerationFromTopic = useCallback(
    (projectId: string, topic: string, settings?: Partial<GenerationSettings>) => {
      const taskId = createTaskId();
      appendTask({
        id: taskId,
        kind: "generation",
        title: `Topic: ${topic}`,
        phase: "generating",
        status: "running",
        progress: 8,
        projectId,
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const result = await api.generateFromTopic(projectId, topic, settings);
          handleGenerationJob(taskId, result.job);
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Topic generation failed",
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
      startGenerationFromWebsite,
      startGenerationFromTopic,
      startAnkiImport,
    }),
    [
      tasks,
      dismissTask,
      getTaskForProject,
      startGenerationFromText,
      startGenerationFromFile,
      startGenerationFromYoutube,
      startGenerationFromWebsite,
      startGenerationFromTopic,
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
    if (task.kind === "anki-import") return "Import complete";
    const count = task.cardsAdded ?? 0;
    return count > 0 ? `${count} card${count === 1 ? "" : "s"} ready` : "Cards ready";
  }
  if (task.status === "failed") {
    return task.error ?? "Failed";
  }
  if (task.phase === "uploading") return "Uploading…";
  if (task.phase === "importing") return "Importing…";
  if (task.phase === "extracting") return "Extracting content…";
  if (task.phase === "chunking") return "Preparing source…";
  return "Generating cards…";
}

export function estimateTaskEtaMs(task: BackgroundTask): number | null {
  if (task.status !== "running") return null;
  const progress = Math.min(Math.max(task.progress, 0), 99.5);
  if (progress < 12) return null;
  const started = task.progressStartedAt ?? task.createdAt;
  const elapsed = Date.now() - started;
  if (elapsed < 2500) return null;
  const remaining = (elapsed * (100 - progress)) / progress;
  return Math.min(Math.max(remaining, 1000), 30 * 60 * 1000);
}

export function formatTaskEta(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `~${sec}s left`;
  const min = Math.ceil(sec / 60);
  return min === 1 ? "~1 min left" : `~${min} min left`;
}
