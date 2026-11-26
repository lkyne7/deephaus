// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CardExplainState } from "@deephaus/shared";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));
vi.mock("@/lib/api/fetch", () => ({ apiFetch: api.apiFetch }));
vi.mock("@/components/rich-text/card-content-renderer", () => ({
  CardContentRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}));

import { ExplainPanel, type ExplainPanelCard } from "@/components/study/explain-panel";

const APPLIED = "Broca's area, left frontal lobe";
const card: ExplainPanelCard = {
  id: "card-1",
  type: "basic",
  front: "Damage to which area impairs speech production?",
  back: APPLIED,
  cloze_text: null,
  extra: null,
};

function saved(thread: CardExplainState["thread"]): CardExplainState {
  return {
    card_id: card.id,
    explanation: { gist: "It turns meaning into speech.", why: [], confusable: null, hook: null, card_issue: null },
    hints: [],
    thread,
    stale: false,
    source: null,
    confusable: null,
    updated_at: "2026-11-10T00:00:00Z",
  };
}

let root: Root;
let host: HTMLDivElement;

async function open(state: CardExplainState, shown: ExplainPanelCard = card) {
  api.apiFetch.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }));
  await act(async () =>
    root.render(<ExplainPanel card={shown} revealed requestedKind="explain" onClose={() => {}} />),
  );
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  api.apiFetch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("shows an applied fix once, with nothing struck through", async () => {
  await open(
    saved([
      { role: "user", text: "Which side?", created_at: "t" },
      { role: "assistant", text: "Left.", suggestion: { kind: "fix", fix: { back: APPLIED }, applied: true }, created_at: "t" },
    ]),
  );
  const fix = host.querySelector(".dh-study__suggestion")!;
  expect(fix.querySelector("del")).toBeNull();
  expect(fix.querySelector("ins")?.textContent).toBe(APPLIED);
  expect(fix.textContent).toContain("Applied to the card");
  expect(fix.querySelector("button")).toBeNull();
});

it("does not strike through the card's later text under an earlier applied fix", async () => {
  await open(
    saved([
      { role: "user", text: "Which side?", created_at: "t" },
      { role: "assistant", text: "Left.", suggestion: { kind: "fix", fix: { back: APPLIED }, applied: true }, created_at: "t" },
    ]),
    { ...card, back: "Broca's area (left inferior frontal gyrus)" },
  );
  const fix = host.querySelector(".dh-study__suggestion")!;
  expect(fix.querySelector("del")).toBeNull();
  expect(fix.querySelector("ins")?.textContent).toBe(APPLIED);
});

it("still shows what a pending fix would replace", async () => {
  await open(
    saved([
      { role: "user", text: "Which side?", created_at: "t" },
      { role: "assistant", text: "Left.", suggestion: { kind: "fix", fix: { back: APPLIED } }, created_at: "t" },
    ]),
    { ...card, back: "Broca's area" },
  );
  const fix = host.querySelector(".dh-study__suggestion")!;
  expect(fix.querySelector("del")?.textContent).toBe("Broca's area");
  expect(fix.querySelector("ins")?.textContent).toBe(APPLIED);
  expect(fix.querySelector(".btn-primary")?.textContent).toBe("Apply to card");
});

it("lists each question with its answer", async () => {
  await open(
    saved([
      { role: "user", text: "Which side?", created_at: "t" },
      { role: "assistant", text: "Left.", created_at: "t" },
      { role: "user", text: "Why?", created_at: "t" },
      { role: "assistant", text: "Lateralisation.", created_at: "t" },
    ]),
  );
  const rows = [...host.querySelectorAll(".dh-study__qa")].map((row) => row.textContent);
  expect(rows).toEqual(["Which side?Left.", "Why?Lateralisation."]);
});

it("reveals hints one at a time and keeps the earlier ones", async () => {
  const state: CardExplainState = { ...saved([]), explanation: null, hints: ["First", "Second"] };
  api.apiFetch.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }));
  await act(async () =>
    root.render(<ExplainPanel card={card} revealed={false} requestedKind="hint" onClose={() => {}} />),
  );
  expect(host.querySelector("h2")?.textContent).toBe("First");
  expect(host.textContent).not.toContain("Second");
  await act(async () => (host.querySelector(".btn-primary") as HTMLButtonElement).click());
  expect(host.querySelector("h2")?.textContent).toBe("Second");
  expect(host.querySelector(".dh-study__rows")?.textContent).toBe("First");
  expect(host.querySelector(".btn-primary")).toBeNull();
});

it("closes only its menu on Escape", async () => {
  const onWindowKey = vi.fn();
  window.addEventListener("keydown", onWindowKey);
  await open(saved([]));
  await act(async () => (host.querySelector('[aria-label="More"]') as HTMLButtonElement).click());
  expect(host.querySelector('[role="menu"]')?.textContent).toContain("Write a new one");
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(onWindowKey).not.toHaveBeenCalled();
  window.removeEventListener("keydown", onWindowKey);
});
