// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const background = vi.hoisted(() => ({ startAnkiImport: vi.fn(() => "task-1") }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/background-tasks/context", () => ({
  taskPhaseLabel: () => "",
  useBackgroundTasks: () => ({ tasks: [], startAnkiImport: background.startAnkiImport }),
}));

import { AnkiImportPanel } from "@/components/anki-import-view";

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  background.startAnkiImport.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AnkiImportPanel />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function zone() {
  return host.querySelector<HTMLButtonElement>(".dhi-drop")!;
}

function submit() {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === "Import")!;
}

/** jsdom has no DragEvent, so hand React a plain event carrying the transfer data. */
async function drag(type: string, files: File[], types = ["Files"]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: { types, files, dropEffect: "none" } });
  await act(async () => {
    zone().dispatchEvent(event);
  });
  return event;
}

const apkg = new File(["x"], "biology.apkg");

it("takes a dropped Anki package and imports it", async () => {
  expect(submit().disabled).toBe(true);

  const event = await drag("drop", [apkg]);

  expect(event.defaultPrevented).toBe(true);
  expect(zone().textContent).toContain("biology.apkg");
  expect(submit().disabled).toBe(false);

  await act(async () => submit().click());
  expect(background.startAnkiImport).toHaveBeenCalledWith(apkg, {
    deckName: undefined,
    scheduling: true,
  });
});

it("rejects a dropped file of the wrong type and keeps the form empty", async () => {
  await drag("drop", [apkg]);
  await drag("drop", [new File(["x"], "notes.pdf")]);

  expect(host.querySelector("[role=alert]")?.textContent).toMatch(/\.apkg or \.colpkg/);
  expect(zone().textContent).not.toContain("notes.pdf");
  expect(zone().textContent).toContain("Drop an .apkg or .colpkg here");
  expect(submit().disabled).toBe(true);
});

it("rejects several files dropped at once", async () => {
  await drag("drop", [apkg, new File(["x"], "other.apkg")]);

  expect(host.querySelector("[role=alert]")?.textContent).toBe("Drop one file at a time.");
  expect(submit().disabled).toBe(true);
});

it("highlights while a file is over the zone and ignores other drags", async () => {
  const text = await drag("dragover", [], ["text/plain"]);
  expect(text.defaultPrevented).toBe(false);
  expect(zone().classList.contains("is-over")).toBe(false);

  const over = await drag("dragover", []);
  expect(over.defaultPrevented).toBe(true);
  expect(zone().classList.contains("is-over")).toBe(true);

  await drag("dragleave", []);
  expect(zone().classList.contains("is-over")).toBe(false);
});
