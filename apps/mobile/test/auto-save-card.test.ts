// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ drafts: new Map<string, string>(), userId: "account-a" }));
vi.mock("@/lib/config", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: { user: { id: state.userId } } } }),
} } }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => state.drafts.get(key) ?? null,
  setItem: async (key: string, value: string) => { state.drafts.set(key, value); },
  removeItem: async (key: string) => { state.drafts.delete(key); },
} }));
import { useAutoSaveCard } from "../hooks/use-auto-save-card";
type Props = { snapshot: string; save: () => Promise<void> };
let root: Root;
function Harness(props: Props) {
  useAutoSaveCard({ cardId: "fixture", debounceMs: 20, ...props });
  return null;
}
async function render(props: Props) {
  await act(async () => { root.render(createElement(Harness, props)); });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.drafts.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
it("queues a reverted edit behind the older save and preserves it until saved", async () => {
  let release!: () => void;
  const commits: string[] = [];
  const older = async () => { await new Promise<void>((resolve) => { release = resolve; }); commits.push("edited"); };
  const reverted = async () => { commits.push("original"); };
  await render({ snapshot: "original", save: older });
  await render({ snapshot: "edited", save: older });
  await act(async () => { await vi.advanceTimersByTimeAsync(21); });
  await render({ snapshot: "original", save: reverted });
  await act(async () => { await vi.advanceTimersByTimeAsync(21); });
  const draft = state.drafts.get("deephaus:draft:account-a:fixture");
  await act(async () => { release(); });
  expect(draft).toBe("original");
  await vi.waitFor(() => expect(commits).toEqual(["edited", "original"]));
  expect(state.drafts.size).toBe(0);
});
it("does not keep a stale draft when undo happens before autosave starts", async () => {
  const save = vi.fn(async () => {});
  await render({ snapshot: "original", save });
  await render({ snapshot: "abandoned", save });
  await render({ snapshot: "original", save });
  await act(async () => { await vi.advanceTimersByTimeAsync(21); });
  expect(state.drafts.size).toBe(0);
  expect(save).toHaveBeenCalledTimes(1);
});
