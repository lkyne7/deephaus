// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useListSelection } from "@/components/workbench/use-list-selection";

type Item = { id: string };
type Api = ReturnType<typeof useListSelection<Item>>;

let api: Api;
let root: Root;
let host: HTMLDivElement;

function Harness({ items }: { items: Item[] }) {
  api = useListSelection(items);
  return null;
}

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
const checked = () => [...api.checkedIds].sort();

async function render(list: Item[]) {
  await act(async () => root.render(<Harness items={list} />));
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

it("focuses and selects the first row", async () => {
  await render(items);
  expect(api.focusedId).toBe("a");
  expect(checked()).toEqual(["a"]);
  expect(api.bulk).toBe(false);
});

it("replaces the selection on a plain click and extends it with shift", async () => {
  await render(items);
  await act(async () => api.handleRowClick(items[1], 1, plain));
  expect(checked()).toEqual(["b"]);
  await act(async () => api.handleRowClick(items[3], 3, { ...plain, shiftKey: true }));
  expect(checked()).toEqual(["b", "c", "d"]);
  expect(api.focusedId).toBe("d");
  expect(api.bulk).toBe(true);
  expect(api.actionTargets.map((item) => item.id)).toEqual(["b", "c", "d"]);
});

it("toggles one row with cmd or ctrl", async () => {
  await render(items);
  await act(async () => api.handleRowClick(items[2], 2, { ...plain, metaKey: true }));
  expect(checked()).toEqual(["a", "c"]);
  await act(async () => api.handleRowClick(items[0], 0, { ...plain, ctrlKey: true }));
  expect(checked()).toEqual(["c"]);
});

it("moves the single selection with the focus, but leaves a multi-selection alone", async () => {
  await render(items);
  await act(async () => api.moveFocus(1));
  expect(api.focusedId).toBe("b");
  expect(checked()).toEqual(["b"]);

  await act(async () => api.toggleChecked("d", 3));
  await act(async () => api.moveFocus(1));
  expect(api.focusedId).toBe("c");
  expect(checked()).toEqual(["b", "d"]);

  await act(async () => api.moveFocus(Infinity));
  expect(api.focusedId).toBe("d");
  await act(async () => api.moveFocus(-Infinity));
  expect(api.focusedId).toBe("a");
});

it("falls back to the focused row when nothing is selected", async () => {
  await render(items);
  await act(async () => api.clearSelection());
  expect(checked()).toEqual([]);
  expect(api.actionTargets.map((item) => item.id)).toEqual(["a"]);
});

it("refocuses when the focused row leaves the list", async () => {
  await render(items);
  await act(async () => api.focusOnly("c"));
  expect(api.focusedId).toBe("c");
  await render(items.filter((item) => item.id !== "c"));
  expect(api.focusedId).toBe("a");
  await render([]);
  expect(api.focusedId).toBeNull();
});

it("reports whether a requested row exists", async () => {
  await render(items);
  let found = true;
  await act(async () => {
    found = api.focusOnly("missing");
  });
  expect(found).toBe(false);
  expect(api.focusedId).toBe("a");
});
