import { fullSchema } from "./full-schema.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const u = "10000000-0000-4000-8000-000000000001";
const c = "20000000-0000-4000-8000-000000000001";
const plan = "40000000-0000-4000-8000-000000000001";
const event = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** An FSRS-6 state, as builds that predate FSRS-7 send it: no model fields at all. */
const fsrs6State = (day) => ({
  due: `2026-01-${String(day + 1).padStart(2, "0")}T12:00:00Z`,
  last_review: `2026-01-${String(day).padStart(2, "0")}T12:00:00Z`,
  state: 2,
  stability: day,
  difficulty: 5,
  elapsed_days: 1,
  scheduled_days: day,
  reps: day,
  lapses: 0,
  learning_steps: 0,
});
const fsrs7State = (day) => ({ ...fsrs6State(day), stability_fast: day * 3.5, fsrs_version: 7 });

async function setup({ reconciliation }) {
  const { db } = await fullSchema();
  await db.exec(`
    insert into auth.users(id,email) values('${u}','owner@example.test');
    insert into public.projects(id,user_id,name,deck_name) values('${c}','${u}','Fixture','Fixture');
    insert into public.sources(id,user_id,project_id,type) values('${c}','${u}','${c}','text');
    insert into public.generation_jobs(id,source_id) values('${c}','${c}');
    insert into public.cards(id,job_id,type,front,back) values('${c}','${c}','basic','Question','Answer');
    select set_config('request.jwt.claim.sub','${u}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    update launch_features set enabled=${reconciliation} where name='review_reconciliation';
  `);
  return db;
}

async function answer(db, id, day, snapshot, expectedVersion = 0) {
  const log = { ...fsrs6State(day), rating: 3, review: snapshot.last_review, last_elapsed_days: 1, next_state: snapshot };
  return (
    await db.query(
      `select apply_card_review($1::uuid,$2::uuid,0::smallint,$3,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb) as result`,
      [u, c, expectedVersion, event(id), JSON.stringify(snapshot), JSON.stringify(log), JSON.stringify({ next_state: snapshot })],
    )
  ).rows[0].result;
}
const card = async (db) =>
  (await db.query("select stability,stability_fast,fsrs_version,version,reps from card_reviews")).rows[0];

for (const reconciliation of [true, false]) {
  const mode = reconciliation ? "reconciliation on" : "reconciliation off";

  test(`existing rows and FSRS-6 clients are recorded as FSRS-6 (${mode})`, async () => {
    const db = await setup({ reconciliation });
    try {
      await answer(db, 1, 1, fsrs6State(1));
      assert.deepEqual(
        { ...(await card(db)), version: undefined, reps: undefined },
        { stability: 1, stability_fast: null, fsrs_version: 6, version: undefined, reps: undefined },
      );
    } finally { await db.close(); }
  });

  test(`an FSRS-7 state keeps its fast trace and model (${mode})`, async () => {
    const db = await setup({ reconciliation });
    try {
      const result = await answer(db, 1, 1, fsrs7State(1));
      assert.equal(result.next_state.stability_fast, 3.5);
      const row = await card(db);
      assert.equal(row.stability_fast, 3.5);
      assert.equal(row.fsrs_version, 7);
      const logged = (await db.query("select next_state from review_logs")).rows[0].next_state;
      assert.equal(logged.stability_fast, 3.5);
      assert.equal(logged.fsrs_version, 7);
    } finally { await db.close(); }
  });

  test(`an FSRS-6 client grading an FSRS-7 card relabels it FSRS-6, and FSRS-7 can take it back (${mode})`, async () => {
    const db = await setup({ reconciliation });
    try {
      await answer(db, 1, 1, fsrs7State(1));
      await answer(db, 2, 2, fsrs6State(2), 1);
      let row = await card(db);
      // No stale fast trace is left behind under an FSRS-6 label.
      assert.deepEqual([row.stability, row.stability_fast, row.fsrs_version], [2, null, 6]);
      await answer(db, 3, 3, fsrs7State(3), 2);
      row = await card(db);
      assert.deepEqual([row.stability, row.stability_fast, row.fsrs_version], [3, 10.5, 7]);
      assert.equal((await db.query("select count(*)::int as n from review_logs")).rows[0].n, 3);
    } finally { await db.close(); }
  });

  test(`undo across the model change restores the FSRS-6 state, redo the FSRS-7 one (${mode})`, async () => {
    const db = await setup({ reconciliation });
    try {
      await answer(db, 1, 1, fsrs6State(1));
      await answer(db, 2, 2, fsrs7State(2), 1);
      assert.equal((await card(db)).fsrs_version, 7);

      await db.query("select restore_card_review($1::uuid,0::smallint,$2::uuid,true)", [c, event(2)]);
      let row = await card(db);
      assert.deepEqual([row.stability, row.stability_fast, row.fsrs_version], [1, null, 6]);

      await db.query("select restore_card_review($1::uuid,0::smallint,$2::uuid,false)", [c, event(2)]);
      row = await card(db);
      assert.deepEqual([row.stability, row.stability_fast, row.fsrs_version], [2, 7, 7]);
    } finally { await db.close(); }
  });
}

test("a model label without a fast trace is stored as FSRS-6, never as a half FSRS-7 state", async () => {
  const db = await setup({ reconciliation: true });
  try {
    await answer(db, 1, 1, { ...fsrs6State(1), fsrs_version: 7 });
    const row = await card(db);
    assert.deepEqual([row.stability_fast, row.fsrs_version], [null, 6]);
  } finally { await db.close(); }
});

test("invalid model fields are rejected before any history is recorded", async () => {
  const db = await setup({ reconciliation: true });
  try {
    for (const bad of [{ stability_fast: -1 }, { fsrs_version: 5 }, { stability_fast: "NaN" }]) {
      await assert.rejects(answer(db, 9, 1, { ...fsrs7State(1), ...bad }), /Invalid schedule/);
    }
    assert.equal((await db.query("select count(*)::int as n from review_events")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from card_reviews")).rows[0].n, 0);
    await assert.rejects(db.exec("insert into card_reviews(card_id,user_id,due,fsrs_version) select id,'" + u + "',now(),5 from cards"));
  } finally { await db.close(); }
});

test("FSRS-7 weights are stored beside the FSRS-6 fit, which becomes optional", async () => {
  const db = await setup({ reconciliation: true });
  try {
    const seven = Array.from({ length: 34 }, (_, i) => i / 10);
    await db.query("set role authenticated");
    await db.query(
      "insert into user_fsrs_params(user_id,fsrs7_params,fsrs7_log_count,fsrs7_optimized_at) values($1,$2,120,now())",
      [u, seven],
    );
    const row = (await db.query("select params,fsrs7_params,fsrs7_log_count from user_fsrs_params")).rows[0];
    assert.equal(row.params, null);
    assert.equal(row.fsrs7_params.length, 34);
    assert.equal(row.fsrs7_log_count, 120);
  } finally { await db.close(); }
});
