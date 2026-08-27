import assert from "node:assert/strict";
import test from "node:test";
import { createSyncLogger } from "../dist/sync-logger.js";

function captureConsole(run) {
  const calls = [];
  const originals = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    log: console.log,
  };
  for (const level of Object.keys(originals)) {
    console[level] = (...args) => calls.push({ level, args });
  }
  try {
    run();
  } finally {
    Object.assign(console, originals);
  }
  return calls;
}

const RETRYABLE = [
  new TypeError("network error"),
  new TypeError("Failed to fetch"),
  new TypeError("NetworkError when attempting to fetch resource."),
  new TypeError("Load failed"),
  new Error("Network request failed"),
  // The web sync worker serializes records before broadcasting them to tabs.
  "TypeError: network error",
];

for (const error of RETRYABLE) {
  const label = error instanceof Error ? error.message : error;
  test(`dropped sync stream is a warning: ${label}`, () => {
    const logger = createSyncLogger();
    const calls = captureConsole(() => {
      logger.log({ level: 50, message: "Sync error", error });
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, "warn");
    assert.match(calls[0].args[0], /Sync error/);
  });
}

test("genuine sync failures keep error level", () => {
  const logger = createSyncLogger();
  const calls = captureConsole(() => {
    logger.log({
      level: 50,
      message: "Sync error",
      error: new Error("HTTP 401 Unauthorized: token expired"),
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].level, "error");
});

test("non-error records pass through untouched", () => {
  const logger = createSyncLogger();
  const calls = captureConsole(() => {
    logger.log({ level: 30, message: "Sync stream established" });
    logger.log({
      level: 40,
      message: "Sync aborted",
      error: new Error("Cancelling network request before it resolves."),
    });
  });

  assert.deepEqual(
    calls.map((call) => call.level),
    ["info", "warn"],
  );
});
