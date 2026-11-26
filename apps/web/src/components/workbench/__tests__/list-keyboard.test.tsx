// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSelectAllShortcut } from "@/components/workbench/list-keyboard";

let root: Root;
let host: HTMLDivElement;
const selectAll = vi.fn();

function Harness() {
  const listRef = useRef<HTMLDivElement>(null);
  useSelectAllShortcut(selectAll, listRef);
  return (
    <>
      <div ref={listRef} tabIndex={0} data-testid="list" />
      <input data-testid="field" />
      <button type="button" data-testid="button" />
      <div role="dialog">
        <button type="button" data-testid="dialog-button" />
      </div>
    </>
  );
}

function press(target: Element, init: KeyboardEventInit = { key: "a", metaKey: true }) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const el = (id: string) => host.querySelector(`[data-testid="${id}"]`)!;

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  selectAll.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("selects all on Cmd+A or Ctrl+A outside text fields and moves focus to the list", () => {
  const event = press(document.body);
  expect(event.defaultPrevented).toBe(true);
  expect(selectAll).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(el("list"));

  press(el("button"), { key: "A", ctrlKey: true });
  expect(selectAll).toHaveBeenCalledTimes(2);
});

it("leaves Cmd+A alone in text fields, dialogs, and with other modifiers", () => {
  expect(press(el("field")).defaultPrevented).toBe(false);
  expect(press(el("dialog-button")).defaultPrevented).toBe(false);
  press(document.body, { key: "a", metaKey: true, shiftKey: true });
  press(document.body, { key: "a" });
  expect(selectAll).not.toHaveBeenCalled();
});
