// The sandboxed preload cannot import src/main/ipc.ts, so it carries a copy
// of the channel names. This keeps the two in step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function channels(file) {
  const source = readFileSync(path.join(root, file), "utf8");
  return Object.fromEntries([...source.matchAll(/^\s+(\w+): "(deephaus:[a-z-]+)",$/gm)].map((m) => [m[1], m[2]]));
}

test("preload IPC channel names match the main process", () => {
  const main = channels("src/main/ipc.ts");
  const preload = channels("src/preload/index.ts");
  assert.ok(Object.keys(main).length >= 8);
  assert.deepEqual(preload, main);
});
