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
  type EnqueueSourceExtractionResponse,
  fetchAnkiImportJob,
  fetchJob,
  fetchSourceExtractionJob,
  readJson,
  type GenerateResponse,
} from "@/lib/background-tasks/api";
import { isAiCreditsExhaustedMessage } from "@/lib/credits/exhausted-message";
import { ANKG_IMPORTS_BUCKET } from "@/lib/import/apkg-import-constants";
import { DIRECT_UPLOAD_MAX_BYTES } from "@/lib/sources/file-types";
import { createClient } from "@/lib/supabase/client";

/** Supabase resumable uploads require a fixed 6 MB chunk size. */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const SOURCE_FILES_BUCKET = "pdfs";
// Hybrid OCR is the production PDF path. It preserves equations as LaTeX;
// explicitly set the flag to "false" only for emergency rollback.
const PDF_EXTRACTION_V2 = process.env.NEXT_PUBLIC_PDF_EXTRACTION_V2 !== "false";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PROJECT_REF =
  SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "_";
const SUPABASE_STORAGE_SETTINGS_URL = `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/storage/settings`;

function formatApkgUploadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /413|maximum size exceeded|payload too large|entitytoolarge/i.test(message)
  ) {
    return (
      "Upload rejected: the file exceeds your Supabase Storage size limit. " +
      "Open Supabase → Storage → Settings and raise the Global file size limit to at least 10 GB " +
      `(the apkg-imports bucket allows up to 10 GB, but a lower global cap blocks the upload). ` +
      `Settings: ${SUPABASE_STORAGE_SETTINGS_URL}`
    );
  }
  return message;
}

export type BackgroundTaskKind = "generation" | "anki-import" | "source";
export type BackgroundTaskPhase =
  | "creating"
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
  /** The source created by an add-source task (kind "source"). */
  sourceId?: string;
  error?: string | null;
  ankiResult?: AnkiImportResult;
  createdAt: number;
  /** Wall-clock when generation/import progress first became meaningful (>0). */
  progressStartedAt?: number;
  extractionJobId?: string;
  pagesCompleted?: number;
  pagesTotal?: number;
};

export type StartDeckGenerationInput = {
  projectId: string | null;
  deckName: string;
  settings: Partial<GenerationSettings>;
  chunkIndices?: number[];
  /** Generate only from this highlighted passage (keeps the same source). */
  scopeText?: string;
  /** When set, generate from this already-stored source (skips re-upload). */
  existingSourceId?: string;
  sourceMode:
    | "text"
    | "document"
    | "website"
    | "google-drive"
    | "video"
    | "topic"
    | "notion";
  videoInputMode?: "upload" | "youtube";
  text?: string;
  topicQuery?: string;
  youtubeUrl?: string;
  notionPageId?: string;
  notionPageTitle?: string;
  websiteUrl?: string;
  googleDriveFileId?: string;
  googleDriveFileName?: string;
  previewRawText?: string | null;
  file?: File | null;
  /** Inline document images into the editable notes (default true). */
  extractImages?: boolean;
  /**
   * When false, only persist the source (upload/extraction) without starting
   * card generation. The task gets kind "source" and reports the new sourceId.
   */
  generate?: boolean;
  onProjectCreated?: (projectId: string, deckName: string) => void;
};

export type StartMultiSourceGenerationInput = {
  projectId: string;
  deckName: string;
  settings: Partial<GenerationSettings>;
  /** Generation runs one job per source, sequentially, as a single task. */
  sources: Array<{ id: string; title?: string }>;
};

type BackgroundTasksContextValue = {
  tasks: BackgroundTask[];
  activeCount: number;
  dismissTask: (taskId: string) => void;
  getTaskForProject: (projectId: string) => BackgroundTask | undefined;
  startDeckGeneration: (input: StartDeckGenerationInput) => string;
  startMultiSourceGeneration: (input: StartMultiSourceGenerationInput) => string;
  startAnkiImport: (
    file: File,
    opts?: { deckName?: string; scheduling?: boolean },
  ) => string;
};

const BackgroundTasksContext = createContext<BackgroundTasksContextValue | null>(null);

function createTaskId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeStorageName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
}

function truncateTopicTitle(topic?: string) {
  const trimmed = topic?.trim() ?? "";
  if (!trimmed) return "Topic generation";
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 47)}…`;
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
  bucketName = ANKG_IMPORTS_BUCKET,
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
        bucketName,
        objectName: storagePath,
        contentType: file.type || "application/octet-stream",
      },
      onError: (err) => reject(new Error(formatApkgUploadError(err))),
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
    if (task.kind === "source") return "Source added";
    const count = task.cardsAdded ?? 0;
    return count > 0 ? `${count} card${count === 1 ? "" : "s"} ready` : "Cards ready";
  }
  if (task.status === "failed") {
    if (isAiCreditsExhaustedMessage(task.error)) {
      return "Out of AI credits — upgrade or wait for your monthly reset";
    }
    return task.error ?? "Failed";
  }
  if (task.phase === "creating") return "Creating deck…";
  if (task.phase === "uploading") return "Uploading…";
  if (task.phase === "importing") return "Importing…";
  if (task.phase === "extracting") {
    if (task.pagesTotal) {
      return `Extracting page ${Math.min(task.pagesCompleted ?? 0, task.pagesTotal)} of ${task.pagesTotal}…`;
    }
    return "Extracting content…";
  }
  if (task.phase === "chunking") return "Preparing source…";
  if (task.kind === "source") return "Adding source…";
  return "Generating cards…";
}

/** Estimate remaining time from elapsed wall-clock and current progress (0–100). */
export function estimateTaskEtaMs(task: BackgroundTask): number | null {
  if (task.status !== "running") return null;
  const progress = Math.min(Math.max(task.progress, 0), 99.5);
  // Need a meaningful fraction complete before extrapolating.
  if (progress < 12) return null;
  const started = task.progressStartedAt ?? task.createdAt;
  const elapsed = Date.now() - started;
  if (elapsed < 2500) return null;
  const remaining = (elapsed * (100 - progress)) / progress;
  // Clamp to a sane UI range (avoid wild early estimates).
  return Math.min(Math.max(remaining, 1000), 30 * 60 * 1000);
}

export function formatTaskEta(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `~${sec}s left`;
  const min = Math.ceil(sec / 60);
  return min === 1 ? "~1 min left" : `~${min} min left`;
}

function mapJobPhase(status: string): BackgroundTaskPhase {
  if (status === "extracting" || status === "uploaded") return "extracting";
  if (status === "chunking") return "chunking";
  return "generating";
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
    (
      taskId: string,
      jobId: string,
      range: { start: number; end: number } = { start: 0, end: 100 },
    ) => {
      stopPolling(taskId);
      const tick = async () => {
        try {
          const job = await fetchJob(jobId);
          if (job.status === "ready") {
            stopPolling(taskId);
            finishGeneration(taskId, job, job.card_count ?? 0);
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
          const jobProgress = Math.min(99, Math.max(0, job.progress ?? 0));
          const progress =
            range.start + ((range.end - range.start) * jobProgress) / 100;
          setTasks((prev) =>
            prev.map((task) => {
              if (task.id !== taskId) return task;
              return {
                ...task,
                phase: mapJobPhase(job.status),
                progress,
                jobId: job.id,
                progressStartedAt:
                  task.progressStartedAt ??
                  (progress >= 10 ? Date.now() : undefined),
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
    [finishGeneration, stopPolling, updateTask],
  );

  const startExtractionPolling = useCallback(
    (taskId: string, extractionJobId: string) => {
      stopPolling(taskId);
      const tick = async () => {
        try {
          const job = await fetchSourceExtractionJob(extractionJobId);
          if (job.status === "failed") {
            stopPolling(taskId);
            updateTask(taskId, {
              status: "failed",
              error: job.error ?? "PDF extraction failed",
            });
            return;
          }
          if (job.status === "ready") {
            stopPolling(taskId);
            if (job.generation_job_id) {
              updateTask(taskId, {
                phase: "generating",
                progress: 45,
                jobId: job.generation_job_id,
                pagesCompleted: job.pages_completed,
                pagesTotal: job.pages_total ?? undefined,
              });
              startPolling(taskId, job.generation_job_id, { start: 45, end: 100 });
            } else {
              updateTask(taskId, {
                status: "ready",
                phase: "extracting",
                progress: 100,
                pagesCompleted: job.pages_completed,
                pagesTotal: job.pages_total ?? undefined,
              });
            }
            return;
          }
          updateTask(taskId, {
            phase: "extracting",
            progress: 18 + Math.round(Math.min(100, Math.max(0, job.progress)) * 0.27),
            extractionJobId,
            pagesCompleted: job.pages_completed,
            pagesTotal: job.pages_total ?? undefined,
          });
        } catch {
          // Ignore transient poll errors.
        }
      };
      void tick();
      const interval = setInterval(() => void tick(), 1000);
      pollTimers.current.set(taskId, interval);
    },
    [startPolling, stopPolling, updateTask],
  );

  /** Terminal state for add-source tasks (kind "source", no generation). */
  const finishSourceAdd = useCallback(
    (taskId: string, source: { id?: string }) => {
      updateTask(taskId, {
        status: "ready",
        progress: 100,
        sourceId: typeof source.id === "string" ? source.id : undefined,
        error: null,
      });
    },
    [updateTask],
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
        phase: mapJobPhase(data.job.status),
        progress: Math.min(99, Math.max(8, data.job.progress ?? 8)),
        jobId: data.job.id,
        progressStartedAt: Date.now(),
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
      const shouldGenerate = input.generate !== false;
      const title =
        input.file?.name ??
        (input.sourceMode === "topic"
          ? truncateTopicTitle(input.topicQuery)
          : input.sourceMode === "notion"
            ? input.notionPageTitle?.trim() || "Notion import"
            : input.sourceMode === "website"
              ? input.websiteUrl?.trim() || "Website import"
              : input.sourceMode === "google-drive"
                ? input.googleDriveFileName?.trim() || "Google Drive import"
            : input.sourceMode === "video" && input.videoInputMode === "youtube"
              ? "YouTube import"
              : input.deckName.trim() ||
                (shouldGenerate ? "Generating cards" : "Adding source"));

      appendTask({
        id: taskId,
        kind: shouldGenerate ? "generation" : "source",
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
            scope_text: input.scopeText,
          };

          // Generate from an existing stored source (edited document on the
          // Create page) — no re-upload, just kick off a fresh job.
          if (input.existingSourceId) {
            updateTask(taskId, { phase: "generating", progress: 35 });
            const genRes = await fetch("/api/generate", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source_id: input.existingSourceId, ...payload }),
            });
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(genRes));
            return;
          }

          if (input.sourceMode === "text") {
            if (!shouldGenerate) {
              updateTask(taskId, { phase: "uploading", progress: 40 });
              const res = await fetch("/api/sources/text", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  project_id: activeProjectId,
                  text: input.text?.trim(),
                }),
              });
              finishSourceAdd(taskId, await readJson<{ id?: string }>(res));
              return;
            }
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

          if (input.sourceMode === "topic") {
            updateTask(taskId, { phase: "generating", progress: 30 });
            const res = await fetch("/api/generate/topic", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                topic: input.topicQuery?.trim(),
                settings: input.settings,
              }),
            });
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(res));
            return;
          }

          if (input.sourceMode === "notion") {
            if (!input.notionPageId) {
              throw new Error("Pick a Notion page to generate from.");
            }
            updateTask(taskId, { phase: "uploading", progress: 22 });
            const sourceRes = await fetch("/api/sources/notion", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                page_id: input.notionPageId,
                generate: shouldGenerate,
                ...payload,
              }),
            });
            if (!shouldGenerate) {
              finishSourceAdd(taskId, await readJson<{ id?: string }>(sourceRes));
              return;
            }
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(sourceRes));
            return;
          }

          if (input.sourceMode === "website") {
            if (!input.websiteUrl?.trim()) {
              throw new Error("Enter a website URL to import.");
            }
            updateTask(taskId, { phase: "uploading", progress: 22 });
            const sourceRes = await fetch("/api/sources/website", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                url: input.websiteUrl.trim(),
                generate: shouldGenerate,
                ...payload,
              }),
            });
            if (!shouldGenerate) {
              finishSourceAdd(taskId, await readJson<{ id?: string }>(sourceRes));
              return;
            }
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(sourceRes));
            return;
          }

          if (input.sourceMode === "google-drive") {
            if (!input.googleDriveFileId) {
              throw new Error("Pick a Google Drive file to import.");
            }
            updateTask(taskId, { phase: "uploading", progress: 12 });
            const sourceRes = await fetch("/api/sources/google-drive", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                file_id: input.googleDriveFileId,
                generate: shouldGenerate,
                ...payload,
              }),
            });
            const imported = await readJson<
              | EnqueueSourceExtractionResponse
              | ({ id?: string } & Partial<GenerateResponse>)
            >(sourceRes);
            if ("extraction_job" in imported && imported.extraction_job) {
              updateTask(taskId, {
                extractionJobId: imported.extraction_job.id,
                sourceId: imported.source.id,
                phase: "extracting",
                progress: 18,
              });
              startExtractionPolling(taskId, imported.extraction_job.id);
              return;
            }
            if (!shouldGenerate) {
              finishSourceAdd(taskId, imported as { id?: string });
              return;
            }
            handleGenerationResponse(taskId, imported as GenerateResponse);
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
                generate: shouldGenerate,
                ...payload,
              }),
            });
            if (!shouldGenerate) {
              finishSourceAdd(taskId, await readJson<{ id?: string }>(sourceRes));
              return;
            }
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(sourceRes));
            return;
          }

          if (!input.file) {
            throw new Error("Choose a file to upload.");
          }

          const isPdf =
            input.file.type === "application/pdf" ||
            input.file.name.toLowerCase().endsWith(".pdf");
          // Multipart through Vercel fails around ~4.5 MB with plain-text 413.
          // Large documents (and all V2 PDFs) upload via resumable TUS instead.
          const useResumable =
            (PDF_EXTRACTION_V2 && isPdf) || input.file.size > DIRECT_UPLOAD_MAX_BYTES;

          if (useResumable) {
            updateTask(taskId, {
              phase: "uploading",
              progress: 4,
              title: input.file.name,
            });
            const supabase = createClient();
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (!session?.user.id || !session.access_token) {
              throw new Error("Sign in again before uploading this file.");
            }
            const storagePath = `${session.user.id}/${activeProjectId}/${Date.now()}-${safeStorageName(input.file.name)}`;
            await resumableUpload(
              input.file,
              storagePath,
              session.access_token,
              (fraction) => {
                updateTask(taskId, {
                  phase: "uploading",
                  progress: 4 + Math.round(fraction * 14),
                });
              },
              SOURCE_FILES_BUCKET,
            );

            if (PDF_EXTRACTION_V2 && isPdf) {
              updateTask(taskId, { phase: "extracting", progress: 18 });
              const enqueueResponse = await fetch("/api/sources/file/enqueue", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  project_id: activeProjectId,
                  storage_path: storagePath,
                  filename: input.file.name,
                  file_size: input.file.size,
                  mime_type: input.file.type || "application/pdf",
                  extract_images: input.extractImages !== false,
                  generate: shouldGenerate,
                  settings: payload.settings,
                  chunk_indices: payload.chunk_indices,
                }),
              });
              const queued =
                await readJson<EnqueueSourceExtractionResponse>(enqueueResponse);
              updateTask(taskId, {
                extractionJobId: queued.extraction_job.id,
                sourceId: queued.source.id,
                phase: "extracting",
                progress: 18,
              });
              startExtractionPolling(taskId, queued.extraction_job.id);
              return;
            }

            updateTask(taskId, {
              phase: shouldGenerate ? "generating" : "uploading",
              progress: 35,
            });
            const sourceRes = await fetch("/api/sources/file/from-storage", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: activeProjectId,
                storage_path: storagePath,
                filename: input.file.name,
                mime_type: input.file.type || "application/octet-stream",
                extract_images: input.extractImages !== false,
                generate: shouldGenerate,
                settings: payload.settings,
                chunk_indices: payload.chunk_indices,
              }),
            });
            if (!shouldGenerate) {
              finishSourceAdd(taskId, await readJson<{ id?: string }>(sourceRes));
              return;
            }
            handleGenerationResponse(taskId, await readJson<GenerateResponse>(sourceRes));
            return;
          }

          updateTask(taskId, {
            phase: "uploading",
            progress: 20,
            title: input.file.name,
          });
          const form = new FormData();
          form.append("project_id", activeProjectId!);
          form.append("file", input.file, input.file.name);
          form.append("generate", shouldGenerate ? "true" : "false");
          form.append("settings", JSON.stringify(payload.settings));
          if (payload.chunk_indices?.length) {
            form.append("chunk_indices", JSON.stringify(payload.chunk_indices));
          }
          if (input.previewRawText) {
            form.append("raw_text", input.previewRawText);
          }
          if (input.extractImages === false) {
            form.append("extract_images", "false");
          }
          updateTask(taskId, {
            phase: shouldGenerate ? "generating" : "uploading",
            progress: 35,
          });
          const sourceRes = await fetch("/api/sources/file", {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (!shouldGenerate) {
            finishSourceAdd(taskId, await readJson<{ id?: string }>(sourceRes));
            return;
          }
          handleGenerationResponse(taskId, await readJson<GenerateResponse>(sourceRes));
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            error: error instanceof Error ? error.message : "Something went wrong",
          });
        }
      })();

      return taskId;
    },
    [
      appendTask,
      finishSourceAdd,
      handleGenerationResponse,
      startExtractionPolling,
      updateTask,
    ],
  );

  /**
   * Poll one generation job to completion, mapping its 0–100 progress into the
   * given task-progress range. Resolves with the number of cards created.
   */
  const awaitGenerationJob = useCallback(
    (taskId: string, jobId: string, range: { start: number; end: number }) =>
      new Promise<{ cardCount: number }>((resolve, reject) => {
        stopPolling(taskId);
        const tick = async () => {
          try {
            const job = await fetchJob(jobId);
            if (job.status === "ready") {
              stopPolling(taskId);
              resolve({ cardCount: job.card_count ?? 0 });
              return;
            }
            if (job.status === "failed") {
              stopPolling(taskId);
              reject(new Error(job.error ?? "Generation failed"));
              return;
            }
            const jobProgress = Math.min(99, Math.max(0, job.progress ?? 0));
            const progress =
              range.start + ((range.end - range.start) * jobProgress) / 100;
            setTasks((prev) =>
              prev.map((task) => {
                if (task.id !== taskId) return task;
                return {
                  ...task,
                  phase: mapJobPhase(job.status),
                  progress,
                  jobId: job.id,
                  progressStartedAt:
                    task.progressStartedAt ??
                    (progress >= 10 ? Date.now() : undefined),
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
      }),
    [stopPolling],
  );

  /**
   * Generate cards from several sources as one background task: one job per
   * source, run sequentially so progress and card counts aggregate cleanly.
   */
  const startMultiSourceGeneration = useCallback(
    (input: StartMultiSourceGenerationInput) => {
      const taskId = createTaskId();
      const count = Math.max(1, input.sources.length);
      appendTask({
        id: taskId,
        kind: "generation",
        title: input.deckName.trim() || "Generating cards",
        phase: "generating",
        status: "running",
        progress: 4,
        projectId: input.projectId,
        createdAt: Date.now(),
      });

      void (async () => {
        let totalCards = 0;
        try {
          for (let index = 0; index < input.sources.length; index += 1) {
            const source = input.sources[index]!;
            const range = {
              start: (index / count) * 100,
              end: ((index + 1) / count) * 100,
            };
            updateTask(taskId, {
              phase: "generating",
              progress: Math.max(4, range.start),
            });
            let data: GenerateResponse;
            try {
              const res = await fetch("/api/generate", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  source_id: source.id,
                  settings: input.settings,
                }),
              });
              data = await readJson<GenerateResponse>(res);
              if (data.job.status === "failed") {
                throw new Error(data.job.error ?? "Generation failed");
              }
              if (data.job.status === "ready") {
                totalCards += data.cards?.length ?? 0;
                continue;
              }
              const { cardCount } = await awaitGenerationJob(taskId, data.job.id, range);
              totalCards += cardCount;
            } catch (error) {
              const message = error instanceof Error ? error.message : "Generation failed";
              throw new Error(
                source.title && input.sources.length > 1
                  ? `${source.title}: ${message}`
                  : message,
              );
            }
          }
          updateTask(taskId, {
            status: "ready",
            phase: "generating",
            progress: 100,
            cardsAdded: totalCards,
            error: null,
          });
        } catch (error) {
          updateTask(taskId, {
            status: "failed",
            cardsAdded: totalCards,
            error: error instanceof Error ? error.message : "Generation failed",
          });
        }
      })();

      return taskId;
    },
    [appendTask, awaitGenerationJob, updateTask],
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
            error: formatApkgUploadError(error),
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
      startMultiSourceGeneration,
      startAnkiImport,
    }),
    [
      tasks,
      dismissTask,
      getTaskForProject,
      startDeckGeneration,
      startMultiSourceGeneration,
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
