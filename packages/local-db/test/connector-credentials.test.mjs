import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseConnector } from "../dist/connector.js";

function makeConnector({ session, refreshed, refreshError } = {}) {
  const calls = { refresh: 0 };
  const connector = new SupabaseConnector({
    client: {
      auth: {
        getSession: async () => ({ data: { session: session ?? null } }),
        refreshSession: async () => {
          calls.refresh += 1;
          if (refreshError) return { data: { session: null }, error: refreshError };
          return { data: { session: refreshed ?? null }, error: null };
        },
      },
    },
    powersyncUrl: "https://sync.example.test",
  });
  return { connector, calls };
}

const nowSec = () => Math.floor(Date.now() / 1000);

test("a fresh token is returned without refreshing", async () => {
  const { connector, calls } = makeConnector({
    session: { access_token: "fresh", expires_at: nowSec() + 3600 },
  });
  assert.deepEqual(await connector.fetchCredentials(), {
    endpoint: "https://sync.example.test",
    token: "fresh",
  });
  assert.equal(calls.refresh, 0);
});

test("an expired token is refreshed before being handed to PowerSync", async () => {
  const { connector, calls } = makeConnector({
    session: { access_token: "expired", expires_at: nowSec() - 10 },
    refreshed: { access_token: "renewed", expires_at: nowSec() + 3600 },
  });
  assert.deepEqual(await connector.fetchCredentials(), {
    endpoint: "https://sync.example.test",
    token: "renewed",
  });
  assert.equal(calls.refresh, 1);
});

test("a token expiring within the margin is refreshed proactively", async () => {
  const { connector, calls } = makeConnector({
    session: { access_token: "stale-soon", expires_at: nowSec() + 30 },
    refreshed: { access_token: "renewed", expires_at: nowSec() + 3600 },
  });
  assert.deepEqual(await connector.fetchCredentials(), {
    endpoint: "https://sync.example.test",
    token: "renewed",
  });
  assert.equal(calls.refresh, 1);
});

test("an expired token with a failed refresh yields no credentials", async () => {
  const { connector } = makeConnector({
    session: { access_token: "expired", expires_at: nowSec() - 10 },
    refreshError: new Error("offline"),
  });
  // Returning null lets PowerSync back off instead of sending a doomed request.
  assert.equal(await connector.fetchCredentials(), null);
});

test("a near-expiry token survives a failed refresh", async () => {
  const { connector } = makeConnector({
    session: { access_token: "stale-soon", expires_at: nowSec() + 30 },
    refreshError: new Error("offline"),
  });
  assert.deepEqual(await connector.fetchCredentials(), {
    endpoint: "https://sync.example.test",
    token: "stale-soon",
  });
});

test("no session yields no credentials", async () => {
  const { connector, calls } = makeConnector({ session: null });
  assert.equal(await connector.fetchCredentials(), null);
  assert.equal(calls.refresh, 0);
});
