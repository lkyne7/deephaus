// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/components/deck-actions-menu", () => ({
  DeckActionsMenu: () => <button type="button">Deck actions</button>,
}));
vi.mock("@/lib/client-cache/hooks/use-dashboard-stats", () => ({
  useDashboardStats: () => ({ data: undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// The side panel's per-deck request; the list itself needs none.
vi.mock("swr", () => ({ default: () => ({ data: undefined, error: undefined, mutate: vi.fn() }) }));

import { DeckLibrary } from "@/components/decks/decks-view";

const deck = {
  deck_id: "d1",
  name: "Cell biology",
  due: 2,
  new: 1,
  last_reviewed: null,
  total: 5,
  new_card_count: 1,
  is_published: true,
};

let root: Root;
let host: HTMLDivElement;

async function render(props: React.ComponentProps<typeof DeckLibrary>) {
  await act(async () => {
    root.render(<DeckLibrary {...props} />);
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("shows a skeleton while loading and a retry when loading failed", async () => {
  await render({ decks: undefined });
  expect(host.querySelector("[aria-busy]")).not.toBeNull();

  const onRetry = vi.fn();
  await render({ decks: undefined, failed: true, onRetry });
  expect(host.textContent).toContain("Couldn't load your decks");
  await act(async () => {
    host.querySelector<HTMLButtonElement>(".dh-load-error button")?.click();
  });
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("has an empty state with no decks", async () => {
  await render({ decks: [] });
  expect(host.textContent).toContain("You haven't created any decks");
});

it("lists a deck with a Study link and shows it in the side panel", async () => {
  await render({ decks: [deck] });
  const row = host.querySelector<HTMLElement>("[data-deck-id='d1']");
  expect(row?.getAttribute("role")).toBe("listitem");
  expect(row?.getAttribute("aria-current")).toBe("true");
  expect(row?.textContent).toContain("Cell biology");
  expect(row?.textContent).toContain("2 due");
  expect(row?.querySelector('a[href="/decks/d1/study"]')?.getAttribute("aria-label")).toBe(
    "Study Cell biology",
  );

  const panel = host.querySelector<HTMLElement>('aside[aria-label="Deck summary"]');
  expect(panel?.querySelector('a[href="/decks/d1"]')?.textContent).toContain("Open deck");
  expect(panel?.querySelector('a[href="/decks/d1/study"]')?.textContent).toBe("Study 3 cards");
  expect(panel?.textContent).toContain("Published");
  expect(panel?.textContent).toContain("Deck actions");
});

it("marks a paused deck and keeps it out of the due total", async () => {
  await render({
    decks: [deck, { ...deck, deck_id: "d2", name: "Old course", due: 7, paused: true, is_published: false }],
  });
  const paused = host.querySelector<HTMLElement>("[data-deck-id='d2']");
  expect(paused?.textContent).toContain("Paused");
  expect(paused?.textContent).not.toContain("7 due");
  expect(host.querySelector(".dh-bench-count")?.textContent).toBe("2 decks · 2 due");
});

it("switches to the bulk bar and panel when a second deck is ticked", async () => {
  await render({ decks: [deck, { ...deck, deck_id: "d2", name: "Anatomy", is_published: false }] });
  await act(async () => {
    host.querySelector<HTMLElement>("[data-deck-id='d2'] .dh-bench-row__check")?.click();
  });
  expect(host.querySelector('[role="toolbar"]')?.textContent).toContain("2 selected");
  const panel = host.querySelector<HTMLElement>('aside[aria-label="Selected decks"]');
  expect(panel?.textContent).toContain("2 decks selected");
  // One of them is published, so merging is off the table.
  expect(panel?.textContent).toContain("can't be merged");
});
