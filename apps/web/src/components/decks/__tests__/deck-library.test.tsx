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

it("links a deck to its page and keeps Study and tags", async () => {
  await render({ decks: [deck] });
  const link = host.querySelector<HTMLAnchorElement>("[data-deck-id='d1']");
  expect(link?.getAttribute("href")).toBe("/decks/d1");
  expect(host.querySelector('a[href="/decks/d1/study"]')?.textContent).toBe("Study");
  expect(host.textContent).toContain("Published");
  expect(host.textContent).toContain("Deck actions");
});
