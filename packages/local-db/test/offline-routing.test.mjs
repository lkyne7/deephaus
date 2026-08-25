import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSyncedPastServerWrite,
  shouldUseLocalRead,
  shouldUseLocalWrite,
} from "../dist/offline-routing.js";
import {
  getLocalOwnerIds,
  localDataNeedsReset,
} from "../dist/queries/user-scope.js";
import { SupabaseConnector } from "../dist/connector.js";

test("local owner detection reads persisted account identifiers", async () => {
  let query = "";
  const db = {
    getAll: async (sql) => {
      query = sql;
      return [{ user_id: "user-a" }];
    },
  };

  await assert.doesNotReject(async () => {
    assert.deepEqual(await getLocalOwnerIds(db), ["user-a"]);
  });
  assert.match(query, /FROM projects/);
  assert.match(query, /FROM user_profiles/);
  assert.match(query, /LIMIT 2/);
});

test("local reads preserve pending writes while online", () => {
  assert.equal(
    shouldUseLocalRead({ online: true, hasPendingWrites: true }),
    true,
  );
  assert.equal(
    shouldUseLocalRead({ online: true, hasPendingWrites: false }),
    false,
  );
});

test("local reads handle offline and transport-failure fallbacks", () => {
  assert.equal(shouldUseLocalRead({ online: false }), true);
  assert.equal(shouldUseLocalRead({ online: true, forceLocal: true }), true);
});

test("online writes use the server until the first local sync", () => {
  assert.equal(
    shouldUseLocalWrite({
      online: true,
      hasPendingWrites: false,
      hasSyncedData: false,
    }),
    false,
  );
  assert.equal(
    shouldUseLocalWrite({
      online: true,
      hasPendingWrites: false,
      hasSyncedData: true,
    }),
    true,
  );
});

test("writes still queue when offline or after a transport failure", () => {
  assert.equal(shouldUseLocalWrite({ online: false }), true);
  assert.equal(shouldUseLocalWrite({ online: true, forceLocal: true }), true);
});

test("server writes hold local routing until a newer sync checkpoint", () => {
  const serverWriteAt = Date.parse("2026-08-24T20:00:00.000Z");
  assert.equal(
    hasSyncedPastServerWrite(
      true,
      new Date("2026-08-24T19:59:59.000Z"),
      serverWriteAt,
    ),
    false,
  );
  assert.equal(
    hasSyncedPastServerWrite(
      true,
      new Date("2026-08-24T20:00:01.000Z"),
      serverWriteAt,
    ),
    true,
  );
  assert.equal(hasSyncedPastServerWrite(true, undefined, 0), true);
});

test("persisted data is cleared for a different account", () => {
  assert.equal(localDataNeedsReset(["user-a"], null, "user-b"), true);
  assert.equal(localDataNeedsReset(["user-a"], "user-a", "user-b"), true);
  assert.equal(localDataNeedsReset(["user-a"], "user-a", "user-a"), false);
  assert.equal(localDataNeedsReset([], null, "user-a"), false);
});

test("unsupported writes remain queued instead of being silently discarded", async () => {
  let completed = false;
  const connector = new SupabaseConnector({
    client: {},
    powersyncUrl: "https://sync.example.test",
  });
  const database = {
    getNextCrudTransaction: async () => ({
      crud: [{ table: "user_profiles", id: "profile-1", op: "PUT" }],
      complete: async () => {
        completed = true;
      },
    }),
  };

  await assert.rejects(
    connector.uploadData(database),
    /Refusing write to non-writable table user_profiles/,
  );
  assert.equal(completed, false);
});

test("queued Cram reviews replay through the version-checked RPC", async () => {
  let completed = false;
  let rpcCall = null;
  const connector = new SupabaseConnector({
    client: {
      rpc: async (name, args) => {
        rpcCall = { name, args };
        return { error: null };
      },
    },
    powersyncUrl: "https://sync.example.test",
  });
  const database = {
    getNextCrudTransaction: async () => ({
      crud: [
        {
          table: "cram_plan_items",
          id: "item-1",
          op: "PATCH",
          opData: { version: 4, due: "2026-08-25T00:00:00.000Z" },
        },
        {
          table: "cram_review_logs",
          id: "log-1",
          op: "PUT",
          opData: {
            plan_id: "plan-1",
            rating: 3,
            response_ms: 1200,
            previous_state: JSON.stringify({ version: 3 }),
            next_state: JSON.stringify({
              due: "2026-08-25T00:00:00.000Z",
              stability: 1,
              difficulty: 5,
              elapsed_days: 0,
              scheduled_days: 1,
              reps: 1,
              lapses: 0,
              state: 1,
              last_review: "2026-08-24T23:00:00.000Z",
              learning_steps: 1,
            }),
          },
        },
      ],
      complete: async () => {
        completed = true;
      },
    }),
  };

  await connector.uploadData(database);

  assert.equal(completed, true);
  assert.equal(rpcCall.name, "record_synced_cram_review");
  assert.equal(rpcCall.args.p_item_id, "item-1");
  assert.equal(rpcCall.args.p_log_id, "log-1");
  assert.equal(rpcCall.args.p_expected_version, 3);
  assert.equal(rpcCall.args.p_rating, 3);
});

test("queued card reviews replay atomically with their mutation UUID", async () => {
  let completed = false;
  let rpcCall = null;
  const connector = new SupabaseConnector({
    client: {
      rpc: async (name, args) => {
        rpcCall = { name, args };
        return { error: null };
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
        completed = true;
      },
    }),
  };

  await connector.uploadData(database);

  assert.equal(completed, true);
  assert.equal(rpcCall.name, "apply_card_review");
  assert.equal(rpcCall.args.p_mutation_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(rpcCall.args.p_expected_version, 7);
  assert.equal(rpcCall.args.p_card_id, "card-1");
});

test("Cram review conflicts keep the PowerSync transaction queued", async () => {
  let completed = false;
  const connector = new SupabaseConnector({
    client: {
      rpc: async () => ({
        error: { code: "40001", message: "Cram Plan item changed" },
      }),
    },
    powersyncUrl: "https://sync.example.test",
  });
  const database = {
    getNextCrudTransaction: async () => ({
      crud: [
        {
          table: "cram_plan_items",
          id: "item-1",
          op: "PATCH",
          opData: { version: 4 },
        },
        {
          table: "cram_review_logs",
          id: "log-1",
          op: "PUT",
          opData: {
            plan_id: "plan-1",
            rating: 3,
            previous_state: JSON.stringify({ version: 3 }),
            next_state: JSON.stringify({ due: "2026-08-25T00:00:00.000Z" }),
          },
        },
      ],
      complete: async () => {
        completed = true;
      },
    }),
  };

  await assert.rejects(
    connector.uploadData(database),
    (error) => error?.code === "40001",
  );
  assert.equal(completed, false);
});
