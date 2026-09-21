// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readDraft, removeDraft } from "@/lib/card-drafts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ userId: "account-a" }));
vi.mock("@/lib/client-cache/user-context", () => ({
  useOptionalAppShellUser: () => ({ id: auth.userId }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: auth.userId } } },
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));
import { useAutoSaveCard } from "../use-auto-save-card";
let root: Root, container: HTMLDivElement;
type Props = {
  snapshot: string;
  save: (isCurrent: () => boolean) => Promise<void>;
  onRestore?: (value: string) => void;
};
function Harness(props: Props) {
  useAutoSaveCard({ cardId: "card", debounceMs: 20, ...props });
  return null;
}
async function render(props: Props) {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
  await act(async () => { await readDraft(`deephaus:draft:${auth.userId}:card`); });
}
beforeEach(async () => {
  await removeDraft("deephaus:draft:account-a:card");
  await removeDraft("deephaus:draft:account-b:card");
  vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  auth.userId = "account-a";
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  container.remove();
});
it("serializes slow saves and retains a newer draft until its own save succeeds", async () => {
  let releaseFirst!: () => void, releaseSecond!: () => void;
  const commits: boolean[] = [];
  const first = vi.fn(async (current: () => boolean) => {
    await new Promise<void>((resolve) => (releaseFirst = resolve));
    commits.push(current());
  });
  const second = vi.fn(async (current: () => boolean) => {
    await new Promise<void>((resolve) => (releaseSecond = resolve));
    commits.push(current());
  });
  await render({ snapshot: "original", save: first });
  await render({ snapshot: "first edit", save: first });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(21);
  });
  expect(first).toHaveBeenCalledTimes(1);
  await render({ snapshot: "latest edit", save: second });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(21);
  });
  expect(second).not.toHaveBeenCalled();
  expect(await readDraft("deephaus:draft:account-a:card")).toBe(
    "latest edit",
  );
  await act(async () => {
    releaseFirst();
    await readDraft("deephaus:draft:account-a:card");
  });
  await act(async () => { await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1)); });
  expect(commits).toEqual([false]);
  expect(await readDraft("deephaus:draft:account-a:card")).toBe(
    "latest edit",
  );
  await act(async () => {
    releaseSecond();
    await readDraft("deephaus:draft:account-a:card");
  });
  expect(commits).toEqual([false, true]);
  await act(async () => { await vi.waitFor(async () => expect(await readDraft("deephaus:draft:account-a:card")).toBeNull()); });
});
it("recovers a failed draft after remount without exposing it to another account", async () => {
  const save = vi.fn(async () => {
    throw new Error("offline");
  });
  await render({ snapshot: "original", save });
  await render({ snapshot: "unsaved work", save });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(21);
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  auth.userId = "account-b";
  const restore = vi.fn();
  await render({ snapshot: "original", save, onRestore: restore });
  expect(restore).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  root = createRoot(container);
  auth.userId = "account-a";
  await render({ snapshot: "original", save, onRestore: restore });
  expect(restore).toHaveBeenCalledWith("unsaved work");
});

it("saves an undo to the original text after an older in-flight edit", async () => {
  let finishOlder!: () => void;
  const saved: string[] = [];
  const older = vi.fn(async () => {
    await new Promise<void>((resolve) => { finishOlder = resolve; });
    saved.push("edited");
  });
  const reverted = vi.fn(async () => { saved.push("original"); });
  await render({ snapshot: "original", save: older });
  await render({ snapshot: "edited", save: older });
  await act(async () => { await vi.advanceTimersByTimeAsync(21); });
  await render({ snapshot: "original", save: reverted });
  await act(async () => { await vi.advanceTimersByTimeAsync(21); });
  expect(await readDraft("deephaus:draft:account-a:card")).toBe("original");
  await act(async () => { finishOlder(); });
  await act(async () => { await vi.waitFor(() => expect(reverted).toHaveBeenCalledTimes(1)); });
  expect(saved).toEqual(["edited", "original"]);
});

it("does not restore an abandoned edit after undoing before the debounce", async () => {
  const save = vi.fn(async () => {});
  await render({ snapshot: "original", save });
  await render({ snapshot: "abandoned edit", save });
  await render({ snapshot: "original", save });
  await act(async () => { await vi.advanceTimersByTimeAsync(21); });
  await act(async () => { await vi.waitFor(async () => expect(await readDraft("deephaus:draft:account-a:card")).toBeNull()); });
  await act(async () => root.unmount());
  root = createRoot(container);
  const onRestore = vi.fn();
  await render({ snapshot: "original", save, onRestore });
  expect(onRestore).not.toHaveBeenCalled();
});
