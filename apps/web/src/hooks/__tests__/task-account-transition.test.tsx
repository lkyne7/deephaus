// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  user: "a",
  listener: null as any,
  fetch: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: mock.user },
            access_token: `token-${mock.user}`,
          },
        },
      }),
      onAuthStateChange: (listener: any) => {
        mock.listener = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
}));
vi.mock("@deephaus/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@deephaus/shared")>()),
  fetchWithDeadline: mock.fetch,
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
import {
  BackgroundTasksProvider,
  useBackgroundTasks,
} from "@/lib/background-tasks/context";
it("does not continue an old account's task or callback after account transition", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let actions!: ReturnType<typeof useBackgroundTasks>;
  function Consumer() {
    actions = useBackgroundTasks();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  let finish!: (response: Response) => void;
  mock.fetch.mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  const onProjectCreated = vi.fn();
  await act(async () => {
    root.render(
      <BackgroundTasksProvider>
        <Consumer />
      </BackgroundTasksProvider>,
    );
  });
  try {
    await act(async () => {
      actions.startDeckGeneration({
        projectId: null,
        deckName: "Fixture",
        settings: {},
        sourceMode: "text",
        text: "Fixture source",
        onProjectCreated,
      });
    });
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    const options = mock.fetch.mock.calls[0][1];
    expect(options.headers.get("Authorization")).toBe("Bearer token-a");
    expect(options.credentials).toBe("omit");
    await act(async () => {
      mock.user = "b";
      mock.listener("SIGNED_IN", { user: { id: "b" } });
    });
    expect(options.signal.aborted).toBe(true);
    await act(async () => {
      finish(Response.json({ id: "old-account-project" }));
    });
    expect(onProjectCreated).not.toHaveBeenCalled();
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    expect(actions.tasks).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});
