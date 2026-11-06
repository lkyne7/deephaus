import type { BackgroundTask } from "@/lib/background-tasks/context";
import type { ThreadMessage } from "@/components/create/create-thread";

/** Oldest messages drop off past this, so a long-lived deck stays cheap to load. */
export const MAX_SAVED_MESSAGES = 200;

type SavedTask = Pick<
  BackgroundTask,
  "id" | "kind" | "title" | "status" | "cardsAdded" | "error" | "stopped"
>;

export type SavedConversation = {
  version: 1;
  messages: ThreadMessage[];
  tasks: SavedTask[];
};

const INTERRUPTED_NOTE = "This was still running when you left. Any cards it finished are in the deck.";

/** The stored form of a conversation: only what's needed to redraw it. */
export function serializeConversation(
  messages: ThreadMessage[],
  tasks: ReadonlyMap<string, BackgroundTask>,
): SavedConversation {
  const kept = messages.slice(-MAX_SAVED_MESSAGES).map((message) =>
    // Undo depends on snapshots held in memory for this session.
    message.role === "assistant" && message.kind === "edit"
      ? { ...message, canUndo: false }
      : message,
  );
  const taskIds = new Set(
    kept.flatMap((message) =>
      message.role === "assistant" && message.kind === "tasks" ? message.taskIds : [],
    ),
  );
  const savedTasks = [...tasks.values()]
    .filter((task) => taskIds.has(task.id))
    .map(({ id, kind, title, status, cardsAdded, error, stopped }) => ({
      id,
      kind,
      title,
      status,
      cardsAdded,
      error,
      stopped,
    }));
  return { version: 1, messages: kept, tasks: savedTasks };
}

/**
 * Rebuild a conversation from storage. Work that was in flight can't be resumed
 * from here, so it's replaced with a note instead of spinning forever.
 */
export function restoreConversation(saved: unknown): {
  messages: ThreadMessage[];
  tasks: Map<string, BackgroundTask>;
} | null {
  const value = saved as Partial<SavedConversation> | null;
  if (value?.version !== 1 || !Array.isArray(value.messages) || !Array.isArray(value.tasks)) {
    return null;
  }

  const tasks = new Map<string, BackgroundTask>();
  for (const task of value.tasks) {
    if (task.status === "running") continue;
    tasks.set(task.id, { ...task, phase: "generating", progress: 100, createdAt: 0 });
  }

  const messages = value.messages.flatMap((message): ThreadMessage[] => {
    if (message.role !== "assistant") return [message];
    if (message.kind === "edit" && message.status === "running") {
      return [{ id: message.id, role: "assistant", kind: "note", text: INTERRUPTED_NOTE }];
    }
    if (message.kind !== "tasks") return [message];
    const finished = message.taskIds.filter((id) => tasks.has(id));
    if (finished.length === message.taskIds.length && !message.pendingGeneration) return [message];
    return [
      ...(finished.length > 0
        ? [{ ...message, taskIds: finished, pendingGeneration: false }]
        : []),
      { id: `${message.id}-note`, role: "assistant", kind: "note", text: INTERRUPTED_NOTE },
    ];
  });

  return { messages, tasks };
}
