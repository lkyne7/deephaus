"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  estimateTaskEtaMs,
  formatTaskEta,
  taskPhaseLabel,
  useBackgroundTasks,
  type BackgroundTask,
} from "@/lib/background-tasks/context";
import { isAiCreditsExhaustedMessage } from "@/lib/credits/exhausted-message";
import { useSettings } from "@/components/settings/settings-context";
import { useAutoDismiss } from "@/lib/use-auto-dismiss";

function pickBannerTask(tasks: BackgroundTask[]) {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length > 0) return running[0];
  const finished = tasks.filter((task) => task.status === "ready" || task.status === "failed");
  return finished[0] ?? null;
}

function taskHref(task: BackgroundTask) {
  if ((task.kind === "generation" || task.kind === "source") && task.projectId) {
    return `/create?deck=${task.projectId}`;
  }
  if (task.kind === "anki-import") {
    return "/create/import";
  }
  return null;
}

export function BackgroundTasksBanner() {
  const { tasks, activeCount, dismissTask, inlineProjectId } = useBackgroundTasks();
  const { openSettings } = useSettings();
  // The Create page reports its open deck's progress in the conversation.
  const task = pickBannerTask(
    inlineProjectId
      ? tasks.filter(
          (candidate) =>
            candidate.projectId !== inlineProjectId ||
            (candidate.kind !== "generation" && candidate.kind !== "source"),
        )
      : tasks,
  );
  const [, setNowTick] = useState(0);

  // Refresh ETA every second while a task is running.
  useEffect(() => {
    if (!task || task.status !== "running") return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [task?.id, task?.status]);

  const href = useMemo(() => (task ? taskHref(task) : null), [task]);
  const etaMs = task ? estimateTaskEtaMs(task) : null;
  const progressPct = task ? Math.min(100, Math.max(task.progress, 0)) : 0;

  // Successes fade on their own; failures stay until the user dismisses them,
  // otherwise a missed 6-second toast makes an upload look like it vanished.
  useAutoDismiss(
    () => {
      if (task) dismissTask(task.id);
    },
    Boolean(task && task.status === "ready"),
    task?.id,
  );

  if (!task) return null;

  const running = task.status === "running";
  const phase = taskPhaseLabel(task);

  return (
    <div className="dh-task-host" role="status" aria-live="polite">
      <div className="dh-task">
        {running ? (
          <span className="dh-eq-bars" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : (
          <i
            className={`dh-task__icon ${
              task.status === "ready"
                ? "ri-checkbox-circle-fill"
                : "ri-error-warning-fill dh-task__icon--failed"
            }`}
            aria-hidden
          />
        )}

        <span className="dh-task__copy">
          {running ? (
            <span className="dh-task__line" title={`${task.title} · ${phase}`}>
              {task.title} · {phase}
            </span>
          ) : (
            <>
              <span className="dh-task__line">{task.title}</span>
              <span className="dh-task__detail">{phase}</span>
            </>
          )}
        </span>

        {activeCount > 1 ? <span className="dh-pill">{activeCount} running</span> : null}
        {running && etaMs != null ? <span className="dh-task__eta">{formatTaskEta(etaMs)}</span> : null}

        {task.status === "failed" && isAiCreditsExhaustedMessage(task.error) ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openSettings("billing")}>
            View billing
          </button>
        ) : task.kind === "anki-export" && task.status === "ready" && task.exportDownloadUrl ? (
          <a href={task.exportDownloadUrl} download={task.exportFilename} className="btn btn-ghost btn-sm">
            Download
          </a>
        ) : href ? (
          <Link href={href} className="btn btn-ghost btn-sm">
            Open
          </Link>
        ) : null}

        {!running ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => dismissTask(task.id)}
            aria-label="Dismiss"
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        ) : null}

        {running ? (
          <span
            className="dh-task__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
            aria-label="Generation progress"
          >
            <span className="dh-task__fill" style={{ width: `${Math.max(progressPct, 4)}%` }} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
