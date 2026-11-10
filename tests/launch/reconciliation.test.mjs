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
async function answer(db, id, day, user = u, snapshot = state(day), extra = {}) {
  const log = {
    ...state(day),
    rating: 3,
    review: state(day).last_review,
    last_elapsed_days: 1,
    next_state: snapshot,
    ...extra,
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

async function legacyAnswer(db, id, day, version, extra = {}) {
  const log = { ...state(day), rating: 3, review: state(day).last_review, last_elapsed_days: 1, next_state: state(day), ...extra };
  return (
    await db.query(
      `select apply_card_review($1::uuid,$2::uuid,0::smallint,$3,$4::uuid,$5::jsonb,$6::jsonb,'{}'::jsonb) as result`,
      [u, c, version, event(id), JSON.stringify(state(day)), JSON.stringify(log)],
    )
  ).rows[0].result;
}
const cardRow = async (db) => (await db.query("select stability, version from card_reviews")).rows[0];
const restore = (db, id, undone) =>
  db.query("select restore_card_review($1::uuid,0::smallint,$2::uuid,$3)", [c, event(id), undone]);

test("accounts outside the rollout keep review snapshots so undo and redo restore the schedule", async () => {
  const db = await setup();
  try {
    await db.exec("update launch_features set enabled=false");
    await legacyAnswer(db, 1, 1, 0);
    await legacyAnswer(db, 2, 2, 1);
    const logs = (await db.query("select next_state, previous_state from review_logs order by review")).rows;
    assert.equal(logs[1].next_state.stability, 2);
    assert.equal(logs[1].previous_state.stability, 1);
    await restore(db, 2, true);
    assert.deepEqual(await cardRow(db), { stability: 1, version: 3 });
    await restore(db, 1, true);
    assert.equal((await db.query("select count(*)::int n from card_reviews")).rows[0].n, 0);
    await restore(db, 1, false);
    assert.deepEqual(await cardRow(db), { stability: 1, version: 1 });
    // The device bumps its version the same way, so its next review applies.
    await legacyAnswer(db, 3, 3, 1);
    assert.deepEqual(await cardRow(db), { stability: 3, version: 2 });
    // Replays return the stored response without rewriting history.
    await legacyAnswer(db, 3, 3, 1);
    assert.equal((await db.query("select count(*)::int n from review_events")).rows[0].n, 3);
  } finally {
    await db.close();
  }
});

test("undoing a review recorded without snapshots is history-only and keeps the device's version in step", async () => {
  const db = await setup();
  try {
    await db.exec("update launch_features set enabled=false");
    await legacyAnswer(db, 1, 1, 0);
    await db.exec("delete from review_events; update review_logs set next_state=null, previous_state=null");
    const result = (await restore(db, 1, true)).rows[0].restore_card_review;
    assert.equal(result.reconciliation, "history_only");
    assert.equal((await db.query("select undone from review_logs")).rows[0].undone, true);
    assert.deepEqual(await cardRow(db), { stability: 1, version: 2 });
    await legacyAnswer(db, 2, 2, 2);
    assert.deepEqual(await cardRow(db), { stability: 2, version: 3 });
  } finally {
    await db.close();
  }
});

const exam = "40000000-0000-4000-8000-000000000001";
const answerDetails = async (db, id) =>
  (await db.query("select context, exam_id, response_ms from review_logs where id=$1", [event(id)])).rows[0];

const addExam = (db, owner = u) =>
  db.exec(`insert into public.exams(id,user_id,name,exam_at) values('${exam}','${owner}','Finals','2027-01-01')`);

test("a review records where it was answered, its exam and its answer time", async () => {
  const db = await setup();
  try {
    await addExam(db);
    const recorded = { context: "exam", exam_id: exam, response_ms: 4200 };
    await answer(db, 2, 2, u, state(2), recorded);
    assert.deepEqual(await answerDetails(db, 2), recorded);
    // An older answer arriving late is kept as history only, with the same details.
    const late = { context: "cram", exam_id: null, response_ms: 0 };
    assert.equal((await answer(db, 1, 1, u, state(1), late)).reconciliation, "history_only");
    assert.deepEqual(await answerDetails(db, 1), late);
    // A replay returns the stored response and leaves the recorded details alone.
    await answer(db, 2, 2, u, state(2), { context: "study", response_ms: 1 });
    assert.deepEqual(await answerDetails(db, 2), recorded);
    // Undo and redo leave them alone too.
    await restore(db, 2, true);
    await restore(db, 2, false);
    assert.deepEqual(await answerDetails(db, 2), recorded);
    assert.equal((await db.query("select stability from card_reviews")).rows[0].stability, 2);
  } finally {
    await db.close();
  }
});

test("an exam id that is not one of the reviewer's exams is cleared, never a reason to refuse the answer", async () => {
  const db = await setup();
  try {
    // No such exam: for example one deleted while this answer waited offline.
    await answer(db, 1, 1, u, state(1), { context: "exam", exam_id: exam, response_ms: 900 });
    assert.deepEqual(await answerDetails(db, 1), { context: "exam", exam_id: null, response_ms: 900 });
    // Someone else's exam is not this reviewer's to point at.
    await addExam(db, other);
    await answer(db, 2, 2, u, state(2), { context: "exam", exam_id: exam });
    assert.equal((await answerDetails(db, 2)).exam_id, null);
    assert.equal((await db.query("select stability from card_reviews")).rows[0].stability, 2);
  } finally {
    await db.close();
  }
});

test("deleting an exam keeps the reviews that counted towards it", async () => {
  const db = await setup();
  try {
    await addExam(db);
    await answer(db, 1, 1, u, state(1), { context: "exam", exam_id: exam });
    assert.equal((await answerDetails(db, 1)).exam_id, exam);
    await db.exec(`delete from public.exams where id='${exam}'`);
    assert.deepEqual(await answerDetails(db, 1), { context: "exam", exam_id: null, response_ms: null });
  } finally {
    await db.close();
  }
});

test("reviews without the new details are study, and unusable details never reject a review", async () => {
  const db = await setup();
  try {
    await answer(db, 1, 1);
    assert.deepEqual(await answerDetails(db, 1), { context: "study", exam_id: null, response_ms: null });
    await answer(db, 2, 2, u, state(2), { context: "quiz", exam_id: "not-a-uuid", response_ms: 3600001 });
    assert.deepEqual(await answerDetails(db, 2), { context: "study", exam_id: null, response_ms: null });
    await answer(db, 3, 3, u, state(3), { context: 7, exam_id: 7, response_ms: "4200" });
    assert.deepEqual(await answerDetails(db, 3), { context: "study", exam_id: null, response_ms: null });
    await answer(db, 4, 4, u, state(4), { response_ms: -1 });
    assert.equal((await answerDetails(db, 4)).response_ms, null);
    await answer(db, 5, 5, u, state(5), { response_ms: 3600000 });
    assert.equal((await answerDetails(db, 5)).response_ms, 3600000);
    await assert.rejects(db.query("update review_logs set context='quiz'"), /check constraint/);
    await assert.rejects(db.query("update review_logs set response_ms=3600001"), /check constraint/);
  } finally {
    await db.close();
  }
});

test("accounts outside the rollout record the same details", async () => {
  const db = await setup();
  try {
    await db.exec("update launch_features set enabled=false");
    await addExam(db);
    const recorded = { context: "exam", exam_id: exam, response_ms: 4200 };
    await legacyAnswer(db, 1, 1, 0, recorded);
    assert.deepEqual(await answerDetails(db, 1), recorded);
    await legacyAnswer(db, 2, 2, 1, { context: "quiz", response_ms: 3600001 });
    assert.deepEqual(await answerDetails(db, 2), { context: "study", exam_id: null, response_ms: null });
    // A replay must not rewrite what was recorded.
    await legacyAnswer(db, 1, 1, 0, { context: "study" });
    assert.deepEqual(await answerDetails(db, 1), recorded);
    await restore(db, 2, true);
    assert.deepEqual(await cardRow(db), { stability: 1, version: 3 });
  } finally {
    await db.close();
  }
});
