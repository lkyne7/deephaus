"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  estimateTaskEtaMs,
  formatTaskEta,
  taskPhaseLabel,
  type BackgroundTask,
} from "@/lib/background-tasks/context";
import {
  AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE,
  isAiCreditsExhaustedMessage,
} from "@/lib/credits/exhausted-message";

export type ThreadSourceRef = { icon: string; label: string };

/**
 * One entry in the Create conversation. The thread is a client-side record of
 * this session: user requests, live background-task progress, and edit results.
 */
export type ThreadMessage =
  | {
      id: string;
      role: "user";
      text: string;
      sources: ThreadSourceRef[];
      /** Cards the message was scoped to, e.g. "3 selected cards". */
      scope?: string;
    }
  | {
      id: string;
      role: "assistant";
      kind: "tasks";
      taskIds: string[];
      /** Shown while sources finish processing before generation starts. */
      pendingGeneration?: boolean;
      /** Cards come from a named topic rather than a stored source. */
      topic?: boolean;
      /** What each task is working from, by task id, when its own title is less specific. */
      labels?: Record<string, string>;
    }
  | {
      id: string;
      role: "assistant";
      kind: "edit";
      status: "running" | "done" | "error";
      scopeLabel: string;
      updated?: number;
      summary?: string;
      error?: string;
      canUndo?: boolean;
    }
  | { id: string; role: "assistant"; kind: "note"; text: string; tone?: "error" };

type Props = {
  messages: ThreadMessage[];
  /** Latest known state of every task referenced by the thread. */
  tasks: ReadonlyMap<string, BackgroundTask>;
  /** Shown above the first message (deck summary, suggestions). */
  intro?: ReactNode;
  undoing?: boolean;
  onUndoEdit: (messageId: string) => void;
  onOpenBilling: () => void;
};

export function WorkingBars() {
  return (
    <span className="dhc-eq" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Working({ label, meta, progress }: { label: string; meta?: string | null; progress?: number }) {
  return (
    <div className="dhc-task dhc-task--running" role="status">
      <WorkingBars />
      <div className="dhc-task__body">
        <div>{label}</div>
        {meta ? <div className="dhc-task__meta">{meta}</div> : null}
        {progress != null ? (
          <div className="dhc-progress" aria-hidden>
            <span style={{ width: `${Math.min(100, Math.max(4, progress))}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Done({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

function Failure({ message, onOpenBilling }: { message: string; onOpenBilling: () => void }) {
  const credits = isAiCreditsExhaustedMessage(message);
  return (
    <div className="dhc-task dhc-task--error" role="alert">
      <i className="ri-error-warning-line dhc-task__warn" aria-hidden />
      <div className="dhc-task__body">
        {credits ? AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE : message}
        {credits ? (
          <>
            {" "}
            <button type="button" className="dhc-link" onClick={onOpenBilling}>
              View billing
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  label,
  topic,
  onOpenBilling,
}: {
  task: BackgroundTask;
  label?: string;
  topic?: boolean;
  onOpenBilling: () => void;
}) {
  const title = label ?? task.title;
  if (task.status === "running") {
    const eta = estimateTaskEtaMs(task);
    const soFar = task.cardsAdded ? `${task.cardsAdded} so far` : null;
    const meta = [title, soFar, eta != null ? formatTaskEta(eta) : null]
      .filter(Boolean)
      .join(" · ");
    return <Working label={taskPhaseLabel(task)} meta={meta} progress={task.progress} />;
  }
  if (task.status === "failed") {
    return (
      <Failure
        message={task.error?.trim() || `${title} failed. Please try again.`}
        onOpenBilling={onOpenBilling}
      />
    );
  }
  if (task.kind === "source") {
    return (
      <Done>
        Added <strong>{title}</strong> to this deck&apos;s sources.
      </Done>
    );
  }
  const count = task.cardsAdded ?? 0;
  if (task.stopped) {
    return (
      <Done>
        Stopped.{" "}
        {count > 0 ? (
          <>
            Kept the <strong>{count} {count === 1 ? "card" : "cards"}</strong> finished so far.
          </>
        ) : (
          "No cards were added."
        )}
      </Done>
    );
  }
  if (count === 0) {
    return <Done>No new cards. This deck already covers everything here.</Done>;
  }
  // Titles can already end in "…" or a full stop; the sentence adds its own.
  const subject = title.trim().replace(/[.…\s]+$/, "");
  return (
    <Done>
      Generated <strong>{count} {count === 1 ? "card" : "cards"}</strong>
      {subject ? (
        <>
          {topic ? " on " : " from "}
          {subject}
        </>
      ) : null}
      .
    </Done>
  );
}

/** Conversation column of the Create page. */
export function CreateThread({ messages, tasks, intro, undoing, onUndoEdit, onOpenBilling }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastId, messages.length]);

  return (
    <div ref={scrollRef} className="dhc-thread" aria-live="polite">
      {intro}
      {messages.map((message) => {
        if (message.role === "user") {
          return (
            <div key={message.id} className="dhc-msg dhc-msg--user">
              {message.sources.length > 0 || message.scope ? (
                <div className="dhc-msg__refs">
                  {message.scope ? (
                    <span className="dhc-ref dhc-ref--scope">
                      <i className="ri-checkbox-multiple-line" aria-hidden />
                      <span>{message.scope}</span>
                    </span>
                  ) : null}
                  {message.sources.map((source, index) => (
                    <span key={index} className="dhc-ref" title={source.label}>
                      <i className={source.icon} aria-hidden />
                      <span>{source.label}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {message.text ? <div>{message.text}</div> : null}
            </div>
          );
        }

        if (message.kind === "note") {
          return (
            <div key={message.id} className="dhc-msg dhc-msg--assistant">
              {message.tone === "error" ? (
                <Failure message={message.text} onOpenBilling={onOpenBilling} />
              ) : (
                message.text
              )}
            </div>
          );
        }

        if (message.kind === "edit") {
          return (
            <div key={message.id} className="dhc-msg dhc-msg--assistant">
              {message.status === "running" ? (
                <Working label={`Editing ${message.scopeLabel}…`} />
              ) : message.status === "error" ? (
                <Failure
                  message={message.error ?? "The assistant could not edit these cards."}
                  onOpenBilling={onOpenBilling}
                />
              ) : (
                <Done>
                  {message.updated === 0 ? (
                    "No cards needed changes."
                  ) : (
                    <>
                      Updated{" "}
                      <strong>
                        {message.updated} {message.updated === 1 ? "card" : "cards"}
                      </strong>
                      .
                    </>
                  )}
                  {message.summary ? <> {message.summary}</> : null}
                  {message.canUndo ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="dhc-link"
                        disabled={undoing}
                        onClick={() => onUndoEdit(message.id)}
                      >
                        {undoing ? "Undoing…" : "Undo"}
                      </button>
                    </>
                  ) : null}
                </Done>
              )}
            </div>
          );
        }

        const rows = message.taskIds
          .map((id) => tasks.get(id))
          .filter((task): task is BackgroundTask => Boolean(task));
        const settled = rows.length > 0 && rows.every((task) => task.status !== "running");
        const wroteCards = rows.some(
          (task) => task.kind === "generation" && task.status === "ready" && task.cardsAdded,
        );
        return (
          <div key={message.id} className="dhc-msg dhc-msg--assistant">
            {rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                label={message.labels?.[task.id]}
                topic={message.topic}
                onOpenBilling={onOpenBilling}
              />
            ))}
            {message.pendingGeneration && settled ? (
              <Working label="Getting ready to generate cards…" />
            ) : null}
            {settled && wroteCards && !message.pendingGeneration && message.id === lastId ? (
              <p className="dhc-msg__followup">
                Tell me what to change, or add another source.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
