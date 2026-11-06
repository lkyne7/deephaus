import assert from "node:assert/strict";
import test from "node:test";
import { browseLocalCards } from "../dist/queries/browse.js";

function recordingDb() {
  const queries = [];
  return {
    queries,
    getAll: async (sql) => {
      queries.push(sql);
      return [];
    },
    get: async (sql) => {
      queries.push(sql);
      return { count: 0 };
    },
  };
}

test("browse without a state does not touch suspension", async () => {
  const db = recordingDb();
  await browseLocalCards(db, {});
  assert.ok(db.queries.every((sql) => !/EXISTS/.test(sql)));
});

test("suspended keeps cards with a suspended review row", async () => {
  const db = recordingDb();
  await browseLocalCards(db, { state: "suspended" });
  assert.equal(db.queries.length, 2);
  for (const sql of db.queries) {
    assert.match(sql, /WHERE EXISTS/);
    assert.match(sql, /cr\.suspended = 1/);
  }
});

test("active excludes cards with a suspended review row", async () => {
  const db = recordingDb();
  await browseLocalCards(db, { state: "active" });
  for (const sql of db.queries) assert.match(sql, /WHERE NOT EXISTS/);
});
