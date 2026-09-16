import { fullSchema } from "./full-schema.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const u = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  c = "20000000-0000-4000-8000-000000000001";
const event = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = (day) => ({
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
async function setup() {
  const { db } = await fullSchema();
  await db.exec(`
    insert into auth.users(id,email) values('${u}','owner@example.test'),('${other}','other@example.test');
    insert into public.projects(id,user_id,name,deck_name) values('${c}','${u}','Launch fixture','Launch fixture');
    insert into public.sources(id,user_id,project_id,type) values('${c}','${u}','${c}','text');
    insert into public.generation_jobs(id,source_id) values('${c}','${c}');
    insert into public.cards(id,job_id,type,front,back) values('${c}','${c}','basic','Question','Answer');
    select set_config('request.jwt.claim.sub','${u}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    update launch_features set enabled=true where name='review_reconciliation';
  `);
  return db;
}
async function answer(db, id, day, user = u, snapshot = state(day)) {
  const log = {
    ...state(day),
    rating: 3,
    review: state(day).last_review,
    last_elapsed_days: 1,
    next_state: snapshot,
  };
  return (
    await db.query(
      `select apply_card_review($1::uuid,$2::uuid,0::smallint,0,$3::uuid,$4::jsonb,$5::jsonb,$6::jsonb) as result`,
      [
        user,
        c,
        event(id),
        JSON.stringify(snapshot),
        JSON.stringify(log),
        JSON.stringify({ next_state: snapshot }),
      ],
    )
  ).rows[0].result;
}
test('deleting an account with review history completes its cascading cleanup', async () => {
  const db = await setup();
  try {
    await answer(db,1,1);
    await db.query('insert into account_deletion_requests(user_id) values($1)',[u]);
    await db.query('delete from auth.users where id=$1',[u]);
    assert.equal((await db.query('select * from review_events')).rows.length,0);
    assert.equal((await db.query('select * from cards')).rows.length,0);
  } finally { await db.close(); }
});
test("both upload orders retain every event and converge to latest answer", async () => {
  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    const db = await setup();
    try {
      for (const n of order) await answer(db, n, n);
      assert.equal(
        (await db.query("select stability from card_reviews")).rows[0]
          .stability,
        2,
      );
      assert.equal(
        (await db.query("select count(*)::int n from review_events")).rows[0].n,
        2,
      );
      assert.equal(
        (await db.query("select count(*)::int n from review_logs")).rows[0].n,
        2,
      );
      await answer(db, 2, 2);
      assert.equal(
        (await db.query("select count(*)::int n from review_logs")).rows[0].n,
        2,
      );
    } finally {
      await db.close();
    }
  }
});
test("ties use mutation ID; old undo preserves newer schedule; undo/redo survives first-review deletion", async () => {
  const db = await setup();
  try {
    await answer(db, 2, 2);
    await answer(db, 1, 2, u, { ...state(2), stability: 1 });
    assert.equal(
      (await db.query("select winning_review_id from card_reviews")).rows[0]
        .winning_review_id,
      event(2),
    );
    await db.query(
      "select restore_card_review($1::uuid,0::smallint,$2::uuid,true)",
      [c, event(1)],
    );
    assert.equal(
      (await db.query("select stability from card_reviews")).rows[0].stability,
      2,
    );
    await db.query(
      "select restore_card_review($1::uuid,0::smallint,$2::uuid,true)",
      [c, event(2)],
    );
    assert.equal(
      (await db.query("select count(*)::int n from card_reviews")).rows[0].n,
      0,
    );
    await db.query(
      "select restore_card_review($1::uuid,0::smallint,$2::uuid,false)",
      [c, event(2)],
    );
    assert.equal(
      (await db.query("select stability from card_reviews")).rows[0].stability,
      2,
    );
  } finally {
    await db.close();
  }
});
test("ownership and invalid scheduling payloads fail before recording history", async () => {
  const db = await setup();
  try {
    await assert.rejects(answer(db, 1, 1, other), /Authentication/);
    await db.exec(
      `select set_config('request.jwt.claim.sub','${other}',false)`,
    );
    await assert.rejects(answer(db, 1, 1, other), /Card not found/);
    await db.exec(`select set_config('request.jwt.claim.sub','${u}',false)`);
    await assert.rejects(
      answer(db, 1, 1, u, { ...state(1), difficulty: -1 }),
      /Invalid schedule/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from review_events")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("deletion blocks further writes and rate limits are shared and atomic", async () => {
  const db = await setup();
  try {
    await db.exec(
      `insert into account_deletion_requests(user_id) values('${u}')`,
    );
    await assert.rejects(answer(db, 1, 1), /Account deletion/);
    const calls = await Promise.all(
      Array.from({ length: 12 }, () =>
        db.query(
          `select consume_api_rate_limit('user:generate',3,60) as allowed`,
        ),
      ),
    );
    assert.equal(calls.filter((x) => x.rows[0].allowed).length, 3);
  } finally {
    await db.close();
  }
});
test("Cram retains both answers in either upload order and reports history-only reconciliation", async () => {
  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    const db = await setup();
    try {
      await db.exec(`insert into cram_plans(id,user_id,name,status,deadline_at,target_retention,daily_minutes) values('${c}','${u}','Test','active','2027-01-01',0.9,20);
  insert into cram_plan_items(id,plan_id,card_id,project_id) values('${c}','${c}','${c}','${c}')`);
      for (const n of order) {
        const next = state(n);
        await db.query(
          "select * from record_synced_cram_review($1::uuid,$1::uuid,$2::uuid,3::smallint,0,$3::jsonb,$4::jsonb,1000)",
          [
            c,
            event(n),
            JSON.stringify(next),
            JSON.stringify({
              ...next,
              review: next.last_review,
              last_elapsed_days: 1,
            }),
          ],
        );
      }
      assert.equal(
        (await db.query("select stability from cram_plan_items")).rows[0]
          .stability,
        2,
      );
      assert.equal(
        (await db.query("select count(*)::int n from cram_review_logs")).rows[0]
          .n,
        2,
      );
    } finally {
      await db.close();
    }
  }
});
test("future clocks are clamped once and replaying an old queued payload is idempotent", async () => {
  const db = await setup();
  try {
    const next = {
      ...state(1),
      last_review: "2099-01-01T00:00:00Z",
      due: "2099-01-02T00:00:00Z",
    };
    const args = [
      u,
      c,
      event(1),
      JSON.stringify(next),
      JSON.stringify({
        ...next,
        rating: 3,
        last_elapsed_days: 1,
        review: next.last_review,
      }),
      JSON.stringify({ next_state: next }),
    ];
    const query =
      "select apply_card_review($1::uuid,$2::uuid,0::smallint,0,$3::uuid,$4::jsonb,$5::jsonb,$6::jsonb) result";
    const result = (await db.query(query, args)).rows[0].result;
    assert.equal(result.clock_adjusted, true);
    const eventRow = (
      await db.query(
        "select raw_answered_at,answered_at,received_at from review_events",
      )
    ).rows[0];
    assert.ok(new Date(eventRow.answered_at) <= new Date(eventRow.received_at));
    assert.equal(new Date(eventRow.raw_answered_at).getUTCFullYear(), 2099);
    assert.deepEqual((await db.query(query, args)).rows[0].result, result);
  } finally {
    await db.close();
  }
});
test("internal rollout can be enabled per account without a global switch", async () => {
  const db = await setup();
  try {
    await db.exec(
      `update launch_features set enabled=false;insert into launch_feature_users values('review_reconciliation','${u}')`,
    );
    await answer(db, 2, 2);
    await answer(db, 1, 1);
    assert.equal(
      (await db.query("select count(*)::int n from review_events")).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
test("flag-off wrapper still enforces ownership and event history is read-only through RLS", async () => {
  const db = await setup();
  try {
    await answer(db, 1, 1);
    await db.exec(
      `update launch_features set enabled=false;select set_config('request.jwt.claim.sub','${other}',false);grant usage on schema auth to authenticated;set role authenticated`,
    );
    await assert.rejects(answer(db, 2, 2, other), /Card not found/);
    assert.equal(
      (await db.query("select count(*)::int n from review_events")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query(`update review_events set undone=true`),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select consume_api_rate_limit('bypass',100,60)`),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("undo and redo update active review counters without erasing history", async () => {
  const db = await setup();
  try {
    await answer(db, 1, 1);
    await answer(db, 2, 2);
    const count = async () =>
      Number(
        (
          await db.query(
            "select review_log_count n from user_stats where user_id=$1",
            [u],
          )
        ).rows[0].n,
      );
    assert.equal(await count(), 2);
    const duplicate = await answer(db, 1, 1);
    assert.equal(duplicate.reconciliation, "history_only");
    assert.equal(duplicate.next_state.stability, 2);
    await db.query(
      "select restore_card_review($1::uuid,0::smallint,$2::uuid,true)",
      [c, event(1)],
    );
    assert.equal(await count(), 1);
    await db.query(
      "select restore_card_review($1::uuid,0::smallint,$2::uuid,false)",
      [c, event(1)],
    );
    assert.equal(await count(), 2);
    assert.equal(
      (await db.query("select count(*)::int n from review_logs")).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});

test("retrying a history-only answer after undo reports its newly authoritative state", async () => {
  const db = await setup();
  try {
    await answer(db,2,2);
    assert.equal((await answer(db,1,1)).reconciliation,"history_only");
    await db.query("select restore_card_review($1::uuid,0::smallint,$2::uuid,true)",[c,event(2)]);
    const retried=await answer(db,1,1);
    assert.equal(retried.reconciliation,"authoritative");
    assert.equal(retried.next_state.stability,1);
    assert.equal((await db.query("select count(*)::int n from review_events")).rows[0].n,2);
  } finally { await db.close(); }
});
