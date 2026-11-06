import { describe, expect, it } from "vitest";
import type { BackgroundTask } from "@/lib/background-tasks/context";
import type { ThreadMessage } from "@/components/create/create-thread";
import {
  MAX_SAVED_MESSAGES,
  restoreConversation,
  serializeConversation,
} from "@/components/create/thread-storage";

const task = (id: string, status: BackgroundTask["status"]): BackgroundTask => ({
  id,
  kind: "generation",
  title: "Notes",
  phase: "generating",
  status,
  progress: 40,
  cardsAdded: 3,
  createdAt: 1,
});

describe("conversation storage", () => {
  it("round-trips finished work", () => {
    const messages: ThreadMessage[] = [
      { id: "u", role: "user", text: "Skip history", sources: [] },
      { id: "a", role: "assistant", kind: "tasks", taskIds: ["t"] },
    ];
    const saved = serializeConversation(messages, new Map([["t", task("t", "ready")]]));
    const restored = restoreConversation(JSON.parse(JSON.stringify(saved)));
    expect(restored?.messages).toEqual(messages);
    expect(restored?.tasks.get("t")).toMatchObject({ status: "ready", cardsAdded: 3 });
  });

  it("never restores an edit as undoable", () => {
    const saved = serializeConversation(
      [
        {
          id: "e",
          role: "assistant",
          kind: "edit",
          status: "done",
          scopeLabel: "all cards",
          canUndo: true,
        },
      ],
      new Map(),
    );
    expect(restoreConversation(saved)?.messages[0]).toMatchObject({ canUndo: false });
  });

  it("replaces in-flight work with a note", () => {
    const saved = serializeConversation(
      [
        { id: "a", role: "assistant", kind: "tasks", taskIds: ["t"] },
        { id: "e", role: "assistant", kind: "edit", status: "running", scopeLabel: "all cards" },
      ],
      new Map([["t", task("t", "running")]]),
    );
    const restored = restoreConversation(saved);
    expect(restored?.tasks.size).toBe(0);
    expect(restored?.messages.map((m) => (m.role === "assistant" ? m.kind : m.role))).toEqual([
      "note",
      "note",
    ]);
  });

  it("keeps the newest messages when a thread grows past the limit", () => {
    const messages = Array.from(
      { length: MAX_SAVED_MESSAGES + 5 },
      (_, i): ThreadMessage => ({ id: `m${i}`, role: "user", text: "x", sources: [] }),
    );
    const saved = serializeConversation(messages, new Map());
    expect(saved.messages).toHaveLength(MAX_SAVED_MESSAGES);
    expect(saved.messages[0]?.id).toBe("m5");
  });

  it("ignores anything it doesn't recognise", () => {
    expect(restoreConversation(null)).toBeNull();
    expect(restoreConversation({ version: 2, messages: [], tasks: [] })).toBeNull();
  });
});
