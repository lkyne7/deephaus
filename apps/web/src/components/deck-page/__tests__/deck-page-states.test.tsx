// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client-cache/hooks/use-dashboard-stats", () => ({
  useDashboardStats: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/fetch", () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ sources: [] }))),
}));
vi.mock("@/components/deck-actions-menu", () => ({ DeckActionsMenu: () => null }));
vi.mock("@/components/deck-page/deck-cards-tab", () => ({ DeckCardsTab: () => null }));
vi.mock("@/components/deck-page/deck-forecast", () => ({
  DeckForecastMini: () => null,
  DeckForecastTab: () => null,
  DeckForecastPanel: () => null,
}));
vi.mock("@/components/settings/settings-context", () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));

import { DeckPageView } from "@/components/deck-page/deck-page-view";

const base = {
  projectId: "deck-1",
  title: "Deck",
  cardCount: 0,
  due: 0,
  newCount: 0,
  isOwner: true,
  publication: null,
  jobId: "job-1",
  jobStatus: null,
  jobError: null,
  jobProgress: 0,
  initialSettings: { desiredRetention: 0.9, newCardsPerDay: 10 },
  globalSettings: { desiredRetention: 0.9, newCardsPerDay: 10 },
  effectiveSettings: { desiredRetention: 0.9, newCardsPerDay: 10 },
  hasOptimizedParams: false,
  initialPanel: null,
  composerDefaults: { detail: "medium", focus: "balanced" },
} as const;

let root: Root;
let host: HTMLDivElement;

async function render(props: Partial<React.ComponentProps<typeof DeckPageView>>) {
  await act(async () => {
    root.render(<DeckPageView {...base} {...props} />);
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  router.refresh.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("offers Add cards on an empty deck and disables Study", async () => {
  await render({ jobId: null });
  expect(host.textContent).toContain("No cards yet");
  expect(host.querySelector('a[href="/create?deck=deck-1"]')?.textContent).toBe("Add cards");
  expect(host.querySelector<HTMLButtonElement>(".dhd-study")?.disabled).toBe(true);
  expect(host.textContent).toContain("Add cards before publishing.");
});

it("shows the job error with Try Again when generation failed", async () => {
  await render({ jobStatus: "failed", jobError: "Out of credits" });
  expect(host.textContent).toContain("Generation failed");
  expect(host.textContent).toContain("Out of credits");
  expect(host.querySelector('a[href="/create?deck=deck-1"]')?.textContent).toBe("Try Again");
});

it("polls a running job and refreshes when it finishes", async () => {
  vi.useFakeTimers();
  const replies = [
    { status: "processing", progress: 60 },
    { status: "ready", progress: 100 },
  ];
  const fetchJob = vi.fn(async () => new Response(JSON.stringify(replies.shift())));
  vi.stubGlobal("fetch", fetchJob);

  await render({ jobStatus: "processing", jobProgress: 10 });
  expect(host.textContent).toContain("Generating your flashcards");
  expect(fetchJob).toHaveBeenCalledWith("/api/jobs/job-1", { credentials: "include" });
  expect(host.querySelector<HTMLElement>(".dhd-state__meter span")?.style.width).toBe("60%");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(router.refresh).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(fetchJob).toHaveBeenCalledTimes(2);
});

it("opens the sharing panel from ?panel=sharing only when the deck can be shared", async () => {
  await render({ cardCount: 3, initialPanel: "sharing" });
  expect(host.querySelector(".dh-panel")?.getAttribute("aria-label")).toBe("Sharing");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render({ cardCount: 0, initialPanel: "sharing" });
  expect(host.querySelector(".dh-panel")).toBeNull();
});
