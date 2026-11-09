import { fullSchema } from "./full-schema.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const bio = "20000000-0000-4000-8000-000000000001";
const chem = "20000000-0000-4000-8000-000000000002";
const exam = "40000000-0000-4000-8000-000000000001";
const card = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY_START = "2026-01-10T04:00:00Z";

async function setup() {
  const { db } = await fullSchema();
  await db.exec(`
    insert into auth.users(id,email) values('${owner}','owner@example.test'),('${other}','other@example.test');
    insert into public.projects(id,user_id,name,deck_name) values
      ('${bio}','${owner}','Biology','Biology'),('${chem}','${owner}','Chemistry','Chemistry');
    insert into public.sources(id,user_id,project_id,type) values
      ('${bio}','${owner}','${bio}','text'),('${chem}','${owner}','${chem}','text');
    insert into public.generation_jobs(id,source_id) values('${bio}','${bio}'),('${chem}','${chem}');
    insert into public.cards(id,job_id,type,front,back,cloze_text,tags,sort_order) values
      ('${card(1)}','${bio}','basic','Q1','A1',null,'{week1}',1),
      ('${card(2)}','${bio}','cloze',null,null,'{{c1::Mitochondria}} make {{c2::ATP}}','{week1}',2),
      ('${card(3)}','${bio}','basic','Q3','A3',null,'{}',3),
      ('${card(4)}','${chem}','basic','Q4','A4',null,'{week1}',1);
  `);
  return db;
}

async function asUser(db, id) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false);
    select set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
}

async function units(db, user, selection) {
  const { rows } = await db.query("select exam_units($1::uuid,$2::jsonb,$3::timestamptz) as units", [
    user,
    JSON.stringify(selection),
    DAY_START,
  ]);
  return rows[0].units;
}

const keys = (rows) => rows.map((row) => `${row.card_id.slice(-1)}:${row.cloze_ord}`);

test("an exam is private to its owner and writable only by them", async () => {
  const db = await setup();
  try {
    await asUser(db, owner);
    await db.exec(`insert into exams(id,user_id,name,exam_at,selection_spec)
      values('${exam}','${owner}','Bio final','2027-01-01','{"deck_ids":["${bio}"]}')`);
    assert.equal((await db.query("select name from exams")).rows[0].name, "Bio final");

    await asUser(db, other);
    assert.equal((await db.query("select count(*)::int n from exams")).rows[0].n, 0);
    await assert.rejects(
      db.exec(`insert into exams(user_id,name,exam_at) values('${owner}','Planted','2027-01-01')`),
      /row-level security/,
    );
    await db.exec(`update exams set name='Hijacked'`);
    await asUser(db, owner);
    assert.equal((await db.query("select name from exams")).rows[0].name, "Bio final");
  } finally {
    await db.close();
  }
});

test("exam settings are held to their allowed ranges", async () => {
  const db = await setup();
  try {
    const insert = (columns, values) =>
      db.exec(`insert into exams(user_id,name,exam_at,${columns}) values('${owner}','x','2027-01-01',${values})`);
    await assert.rejects(insert("target_recall", "0.5"), /check constraint/);
    await assert.rejects(insert("target_recall", "0.99"), /check constraint/);
    await assert.rejects(insert("daily_minutes_cap", "0"), /check constraint/);
    await assert.rejects(insert("result_score", "101"), /check constraint/);
    await insert("target_recall,daily_minutes_cap,result_score", "0.85,20,72.5");
  } finally {
    await db.close();
  }
});

test("exam_units expands a selection into units, in deck order, with real memory and today's grades", async () => {
  const db = await setup();
  try {
    await db.exec(`
      insert into card_reviews(card_id,user_id,cloze_ord,due,stability,stability_fast,difficulty,reps,state,last_review,fsrs_version)
        values('${card(2)}','${owner}',2,'2026-01-12T00:00:00Z',3.5,2.8,5,2,2,'2026-01-09T00:00:00Z',7);
      insert into review_logs(card_id,user_id,cloze_ord,rating,state,due,stability,difficulty,elapsed_days,last_elapsed_days,scheduled_days,review)
        values
        ('${card(1)}','${owner}',0,1,0,now(),0,0,0,0,0,'2026-01-10T09:00:00Z'),
        ('${card(1)}','${owner}',0,3,1,now(),0,0,0,0,0,'2026-01-10T09:10:00Z'),
        ('${card(1)}','${owner}',0,4,2,now(),0,0,0,0,0,'2026-01-09T23:00:00Z');
      update review_logs set undone=true where rating=4;
    `);
    await asUser(db, owner);
    const rows = await units(db, owner, { deck_ids: [bio] });
    assert.deepEqual(keys(rows), ["1:0", "2:1", "2:2", "3:0"]);
    assert.ok(rows.every((row) => row.project_id === bio));

    const seen = rows.find((row) => row.card_id === card(2) && row.cloze_ord === 2);
    assert.equal(seen.review.stability, 3.5);
    assert.equal(seen.review.stability_fast, 2.8);
    assert.equal(seen.review.fsrs_version, 7);
    assert.equal(rows.find((row) => row.cloze_ord === 1).review, null);

    // Today's grades in order; yesterday's and undone ones are not today's.
    assert.deepEqual(rows[0].today, [1, 3]);
    assert.deepEqual(seen.today, []);
  } finally {
    await db.close();
  }
});

test("scoped filters narrow each other and card ids are added on top", async () => {
  const db = await setup();
  try {
    await asUser(db, owner);
    assert.deepEqual(keys(await units(db, owner, { tags: ["week1"] })), ["1:0", "2:1", "2:2", "4:0"]);
    assert.deepEqual(keys(await units(db, owner, { deck_ids: [bio], tags: ["week1"] })), [
      "1:0",
      "2:1",
      "2:2",
    ]);
    assert.deepEqual(keys(await units(db, owner, { source_ids: [chem] })), ["4:0"]);
    assert.deepEqual(keys(await units(db, owner, { deck_ids: [chem], card_ids: [card(3)] })), [
      "3:0",
      "4:0",
    ]);
    // Nothing selected is nothing covered, not everything.
    assert.deepEqual(await units(db, owner, {}), []);
    assert.deepEqual(await units(db, owner, { deck_ids: "not-an-array" }), []);
  } finally {
    await db.close();
  }
});

test("a card with a suspended ordinal is left out whole", async () => {
  const db = await setup();
  try {
    await db.exec(`insert into card_reviews(card_id,user_id,cloze_ord,due,suspended)
      values('${card(2)}','${owner}',1,now(),true)`);
    await asUser(db, owner);
    assert.deepEqual(keys(await units(db, owner, { deck_ids: [bio] })), ["1:0", "3:0"]);
  } finally {
    await db.close();
  }
});

test("exam_units never returns another account's cards", async () => {
  const db = await setup();
  try {
    await asUser(db, other);
    // Asking as yourself for someone else's deck, and asking in their name.
    assert.deepEqual(await units(db, other, { deck_ids: [bio] }), []);
    assert.deepEqual(await units(db, owner, { deck_ids: [bio] }), []);
  } finally {
    await db.close();
  }
});

test("the cram tables and functions are gone, and nothing else referenced them", async () => {
  const db = await setup();
  try {
    const tables = await db.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'cram%'",
    );
    assert.deepEqual(tables.rows, []);
    const functions = await db.query(
      "select proname from pg_proc where proname like '%cram%' and pronamespace='public'::regnamespace",
    );
    assert.deepEqual(functions.rows, []);
    assert.equal((await db.query("select count(*)::int n from review_events where kind='cram'")).rows[0].n, 0);
    // Tables guarded against writes during account deletion still accept writes.
    await db.exec(`insert into public.cards(id,job_id,type,front,back) values('${card(9)}','${bio}','basic','Q','A')`);
  } finally {
    await db.close();
  }
});
