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
  const { tasks, activeCount, dismissTask } = useBackgroundTasks();
  const { openSettings } = useSettings();
  const task = pickBannerTask(tasks);
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

  return (
    <div style={s.host} role="status" aria-live="polite">
      <div style={s.banner}>
        {task.status === "running" ? (
          <span style={s.iconWrap} aria-hidden>
            <i className="ri-loader-4-line icon-spin" style={s.icon} />
          </span>
        ) : (
          <span style={s.iconWrap} aria-hidden>
            <i
              className={task.status === "ready" ? "ri-checkbox-circle-fill" : "ri-error-warning-fill"}
              style={{
                ...s.icon,
                color: task.status === "ready" ? "var(--teal-500)" : "var(--grade-again)",
              }}
            />
          </span>
        )}

        <div style={s.copy}>
          <div style={s.titleRow}>
            <span style={s.title}>{task.title}</span>
            {activeCount > 1 ? <span style={s.badge}>{activeCount} running</span> : null}
          </div>
          <div style={s.subtitleRow}>
            <span style={s.subtitle}>{taskPhaseLabel(task)}</span>
            {task.status === "running" && etaMs != null ? (
              <span style={s.eta}>{formatTaskEta(etaMs)}</span>
            ) : null}
          </div>
          {task.status === "running" ? (
            <div
              style={s.track}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPct)}
              aria-label="Generation progress"
            >
              <div style={{ ...s.fill, width: `${Math.max(progressPct, 4)}%` }} />
            </div>
          ) : null}
        </div>

        {task.status === "failed" && isAiCreditsExhaustedMessage(task.error) ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={s.link}
            onClick={() => openSettings("billing")}
          >
            View billing
          </button>
        ) : href ? (
          <Link href={href} style={s.link} className="btn btn-ghost btn-sm">
            Open
          </Link>
        ) : null}

        {task.status !== "running" ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => dismissTask(task.id)}
            aria-label="Dismiss"
          >
            <i className="ri-close-line" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  host: {
    position: "fixed",
    right: 24,
    bottom: 24,
    zIndex: 60,
    width: "min(420px, calc(100vw - 48px))",
    pointerEvents: "none",
  },
  banner: {
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--border-2)",
    background: "var(--white)",
    boxShadow: "var(--shadow-lg)",
  },
  icon: {
    fontSize: 20,
    color: "var(--teal-500)",
  },
  iconWrap: {
    width: 24,
    height: 24,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    flexShrink: 0,
    font: "600 11px/16px var(--font-sans)",
    color: "var(--teal-700)",
    background: "var(--brand-25)",
    borderRadius: 999,
    padding: "2px 8px",
  },
  subtitleRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    minWidth: 0,
  },
  subtitle: {
    font: "400 12px/17px var(--font-sans)",
    color: "var(--fg-3)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  eta: {
    flexShrink: 0,
    font: "500 11px/17px var(--font-sans)",
    color: "var(--fg-4)",
  },
  track: {
    marginTop: 2,
    height: 4,
    borderRadius: 999,
    background: "var(--ink-50)",
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 999,
    background: "var(--teal-500)",
    transition: "width .35s ease",
  },
  link: {
    flexShrink: 0,
  },
};
