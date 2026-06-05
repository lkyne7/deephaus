"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  taskPhaseLabel,
  useBackgroundTasks,
  type BackgroundTask,
} from "@/lib/background-tasks/context";

function pickBannerTask(tasks: BackgroundTask[]) {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length > 0) return running[0];
  const finished = tasks.filter((task) => task.status === "ready" || task.status === "failed");
  return finished[0] ?? null;
}

function taskHref(task: BackgroundTask) {
  if (task.kind === "generation" && task.projectId) {
    return `/decks/new?deck=${task.projectId}`;
  }
  if (task.kind === "anki-import") {
    return "/decks/import";
  }
  return null;
}

export function BackgroundTasksBanner() {
  const { tasks, activeCount, dismissTask } = useBackgroundTasks();
  const task = pickBannerTask(tasks);

  const href = useMemo(() => (task ? taskHref(task) : null), [task]);

  if (!task) return null;

  return (
    <div style={s.host} role="status" aria-live="polite">
      <div style={s.banner}>
        {task.status === "running" ? (
          <i className="ri-loader-4-line icon-spin" style={s.icon} aria-hidden />
        ) : (
          <i
            className={task.status === "ready" ? "ri-checkbox-circle-fill" : "ri-error-warning-fill"}
            style={{
              ...s.icon,
              color: task.status === "ready" ? "var(--teal-500)" : "var(--grade-again)",
            }}
            aria-hidden
          />
        )}

        <div style={s.copy}>
          <div style={s.titleRow}>
            <span style={s.title}>{task.title}</span>
            {activeCount > 1 ? <span style={s.badge}>{activeCount} running</span> : null}
          </div>
          <span style={s.subtitle}>{taskPhaseLabel(task)}</span>
          {task.status === "running" ? (
            <div style={s.track} aria-hidden>
              <div style={{ ...s.fill, width: `${Math.max(task.progress, 8)}%` }} />
            </div>
          ) : null}
        </div>

        {href ? (
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
    flexShrink: 0,
    fontSize: 20,
    color: "var(--teal-500)",
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
  subtitle: {
    font: "400 12px/17px var(--font-sans)",
    color: "var(--fg-3)",
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
    transition: "width .25s ease",
  },
  link: {
    flexShrink: 0,
  },
};
