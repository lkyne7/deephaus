import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseConnector } from "../dist/connector.js";

// The PATCH a pre-960c7f9 undo queued when it restored "no row before this
// review": every schedule column null. Postgres rejects it (due is NOT NULL).
const unscheduledPatch = {
  table: "card_reviews",
  id: "review-1",
  op: "PATCH",
  opData: {
    due: null,
    stability: null,
    difficulty: null,
    elapsed_days: null,
    scheduled_days: null,
    learning_steps: null,
    reps: null,
    lapses: null,
    state: null,
    version: 3,
    updated_at: "2026-11-09T12:00:00.000Z",
  },
};

function connectorRecording(crud) {
  const calls = [];
  const builder = (table) => ({
    update: (payload) => ({
      eq: async (column, value) => {
        calls.push({ table, op: "update", payload, column, value });
        return { error: null };
      },
    }),
    upsert: async (payload) => {
      calls.push({ table, op: "upsert", payload });
      return { error: null };
    },
    delete: () => ({
      eq: async (column, value) => {
        calls.push({ table, op: "delete", column, value });
        return { error: null };
      },
    }),
  });
  const connector = new SupabaseConnector({
    client: { from: builder, rpc: async () => ({ error: null }) },
    powersyncUrl: "https://sync.example.test",
  });
  let completed = 0;
  const database = {
    getNextCrudTransaction: async () => ({
      crud,
      complete: async () => {
        completed += 1;
      },
    }),
  };
  return {
    calls,
    completed: () => completed,
    upload: () => connector.uploadData(database),
  };
}

test("a queued review schedule with no due date removes the schedule instead of blocking the queue", async () => {
  const { calls, completed, upload } = connectorRecording([unscheduledPatch]);
  await upload();
  assert.deepEqual(calls, [
    { table: "card_reviews", op: "delete", column: "id", value: "review-1" },
  ]);
  assert.equal(completed(), 1);
});

test("an ordinary review schedule change is still sent as an update", async () => {
  const { calls, upload } = connectorRecording([
    {
      table: "card_reviews",
      id: "review-1",
      op: "PATCH",
      opData: { suspended: 1, updated_at: "2026-11-09T12:00:00.000Z" },
    },
  ]);
  await upload();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, "update");
  assert.deepEqual(calls[0].payload, {
    suspended: true,
    updated_at: "2026-11-09T12:00:00.000Z",
  });
});
