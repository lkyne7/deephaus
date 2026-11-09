import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseConnector } from "../dist/connector.js";

const SECOND = 1_000;

function makeUpload(rpc) {
  const calls = { rpc: 0, completed: 0 };
  const connector = new SupabaseConnector({
    client: {
      rpc: async () => {
        calls.rpc += 1;
        return rpc(calls.rpc);
      },
    },
    powersyncUrl: "https://sync.example.test",
  });
  const database = {
    getNextCrudTransaction: async () => ({
      crud: [
        {
          table: "card_reviews",
          id: "review-1",
          op: "PATCH",
          opData: {
            due: "2026-08-25T00:00:00.000Z",
            stability: 1,
            difficulty: 5,
            elapsed_days: 0,
            scheduled_days: 1,
            learning_steps: 0,
            reps: 2,
            lapses: 0,
            state: 2,
            last_review: "2026-08-24T23:00:00.000Z",
            version: 8,
          },
        },
        {
          table: "review_logs",
          id: "11111111-1111-4111-8111-111111111111",
          op: "PUT",
          opData: {
            card_id: "card-1",
            user_id: "user-1",
            cloze_ord: 0,
            rating: 3,
            state: 1,
            due: "2026-08-24T23:00:00.000Z",
            stability: 1,
            difficulty: 5,
            elapsed_days: 0,
            last_elapsed_days: 0,
            scheduled_days: 1,
            review: "2026-08-24T23:00:00.000Z",
            base_version: 7,
          },
        },
      ],
      complete: async () => {
        calls.completed += 1;
      },
    }),
  };
  return { calls, upload: () => connector.uploadData(database) };
}

const conflict = { code: "40001", message: "Card review changed" };
const rejected = () => ({ error: conflict });

test("a rejected upload stays queued and off the server until its backoff expires", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { calls, upload } = makeUpload(rejected);

  await assert.rejects(upload, conflict);
  assert.equal(calls.rpc, 1);

  // The original error is reported, so sync status stays meaningful.
  t.mock.timers.tick(2 * SECOND);
  await assert.rejects(upload, conflict);
  assert.equal(calls.rpc, 1);

  t.mock.timers.tick(3 * SECOND);
  await assert.rejects(upload);
  assert.equal(calls.rpc, 2);
  assert.equal(calls.completed, 0);
});

test("repeated rejections wait longer each time, up to the cap", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  t.mock.method(Math, "random", () => 1);
  const { calls, upload } = makeUpload(rejected);

  const waits = [];
  let waited = 0;
  while (calls.rpc < 9) {
    const before = calls.rpc;
    await assert.rejects(upload);
    if (calls.rpc > before) {
      waits.push(waited);
      waited = 0;
    }
    t.mock.timers.tick(SECOND);
    waited += 1;
  }
  assert.deepEqual(waits, [0, 5, 10, 20, 40, 80, 120, 120, 120]);
});

test("a successful upload clears the backoff", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  t.mock.method(Math, "random", () => 1);
  const { calls, upload } = makeUpload((attempt) =>
    attempt <= 3 ? rejected() : { error: null },
  );

  for (const wait of [0, 5, 10]) {
    t.mock.timers.tick(wait * SECOND);
    await assert.rejects(upload);
  }
  t.mock.timers.tick(20 * SECOND);
  await upload();
  assert.equal(calls.completed, 1);

  await upload();
  assert.equal(calls.rpc, 5);
  assert.equal(calls.completed, 2);
});

test("connection failures retry without a backoff", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  for (const message of [
    "TypeError: Failed to fetch",
    "TypeError: Network request failed",
  ]) {
    const { calls, upload } = makeUpload(() => ({
      error: { code: "", message },
    }));
    await assert.rejects(upload);
    await assert.rejects(upload);
    assert.equal(calls.rpc, 2);
  }
});

test("an overloaded server gets the backoff", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  for (const error of [
    {
      code: "PGRST003",
      message: "Timed out acquiring connection from connection pool.",
    },
    { code: "", message: "upstream request timeout" },
    { code: "", message: "Service Unavailable" },
    { code: "", message: "Bad Gateway" },
    { code: "", message: "TypeError: The request timed out." },
    { code: "57014", message: "canceling statement due to statement timeout" },
  ]) {
    const { calls, upload } = makeUpload(() => ({ error }));
    await assert.rejects(upload);
    await assert.rejects(upload);
    assert.equal(calls.rpc, 1, error.message);
  }
});
