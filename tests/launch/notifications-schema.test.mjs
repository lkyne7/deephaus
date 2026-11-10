import { fullSchema } from "./full-schema.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const third = "10000000-0000-4000-8000-000000000003";

async function setup(options) {
  const { db } = await fullSchema(options);
  await db.exec(`insert into auth.users(id,email) values
    ('${owner}','owner@example.test'),('${other}','other@example.test'),('${third}','third@example.test')`);
  return db;
}
async function asUser(db, id) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false);
    select set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
}
async function asService(db) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);
    select set_config('request.jwt.claim.role','service_role',false); set role service_role;`);
}
const device = (user, token, extra = "") =>
  `insert into push_devices(user_id,platform,token${extra ? ",enabled" : ""}) values('${user}','web','${token}'${extra})`;

test("devices and preferences are private to their owner", async () => {
  const db = await setup();
  try {
    await asUser(db, owner);
    await db.exec(device(owner, "https://push.example/owner-device"));
    await db.exec(`insert into notification_prefs(user_id,daily_time) values('${owner}',1200)`);
    await assert.rejects(db.exec(device(other, "https://push.example/planted")), /row-level security/);

    await asUser(db, other);
    assert.equal((await db.query("select count(*)::int n from push_devices")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from notification_prefs")).rows[0].n, 0);
    await db.exec("update push_devices set enabled=false; update notification_prefs set enabled=false");

    await asUser(db, owner);
    assert.equal((await db.query("select enabled from push_devices")).rows[0].enabled, true);
    assert.deepEqual((await db.query("select enabled,daily_time,quiet_start,quiet_end from notification_prefs")).rows[0],
      { enabled: true, daily_time: 1200, quiet_start: 1320, quiet_end: 480 });
  } finally {
    await db.close();
  }
});

test("one browser is one device row, and settings stay within a day", async () => {
  const db = await setup();
  try {
    await db.exec(device(owner, "https://push.example/shared-browser"));
    await assert.rejects(db.exec(device(other, "https://push.example/shared-browser")), /duplicate key/);
    await assert.rejects(db.exec(`insert into push_devices(user_id,platform,token) values('${owner}','android','some-token-value')`), /check constraint/);
    await assert.rejects(db.exec(`insert into notification_prefs(user_id,quiet_start) values('${owner}',1440)`), /check constraint/);
    await assert.rejects(db.exec(`insert into notification_prefs(user_id,daily_time) values('${owner}',-1)`), /check constraint/);
  } finally {
    await db.close();
  }
});

// Without Supabase's old blanket grants, so only what the migration grants applies.
test("a student can read their reminders and mark them, but not write or rewrite them", async () => {
  const db = await setup({ legacyDefaultGrants: false });
  try {
    await asService(db);
    await db.exec(`insert into notification_log(user_id,kind,dedupe_key,title,body,path)
      values('${owner}','daily_reviews','daily_reviews:2026-11-09','32 cards due','About 11 min.','/review')`);
    // The same occasion is recorded once.
    await assert.rejects(
      db.exec(`insert into notification_log(user_id,kind,dedupe_key,title,body,path)
        values('${owner}','daily_reviews','daily_reviews:2026-11-09','again','again','/review')`),
      /duplicate key/,
    );

    await asUser(db, owner);
    assert.equal((await db.query("select title from notification_log")).rows[0].title, "32 cards due");
    await db.exec("update notification_log set opened_at=now(), desktop_shown_at=now()");
    await assert.rejects(db.exec("update notification_log set title='Rewritten'"), /permission denied/);
    await assert.rejects(
      db.exec(`insert into notification_log(user_id,kind,dedupe_key,title,body,path)
        values('${owner}','test','mine','t','b','/')`),
      /permission denied/,
    );
    await assert.rejects(db.exec("delete from notification_log"), /permission denied/);
    await assert.rejects(db.query("select * from notification_state"), /permission denied/);
    await assert.rejects(db.query("select claim_reminder_checks(10)"), /permission denied/);

    await asUser(db, other);
    assert.equal((await db.query("select count(*)::int n from notification_log")).rows[0].n, 0);
    await db.exec("update notification_log set opened_at=null");
    await asUser(db, owner);
    assert.ok((await db.query("select opened_at from notification_log")).rows[0].opened_at);
  } finally {
    await db.close();
  }
});

test("the dispatcher claims each reachable student once until their next check", async () => {
  const db = await setup();
  try {
    await db.exec(`
      ${device(owner, "https://push.example/owner-1")};
      ${device(owner, "https://push.example/owner-2")};
      ${device(other, "https://push.example/other-off", ",false")};
      ${device(third, "https://push.example/third")};
      insert into notification_prefs(user_id,enabled) values('${third}',false);
    `);
    await asService(db);
    const claim = async () => (await db.query("select claim_reminder_checks(10) as id")).rows.map((row) => row.id);
    // Two devices are one student; a disabled device or reminders switched off is nobody.
    assert.deepEqual(await claim(), [owner]);
    assert.deepEqual(await claim(), []);
    await db.exec(`update notification_state set next_check_at = now() - interval '1 minute'`);
    assert.deepEqual(await claim(), [owner]);
    const state = (await db.query("select next_check_at > now() + interval '4 minutes' as later, checked_at is not null as checked from notification_state")).rows[0];
    assert.deepEqual(state, { later: true, checked: true });
  } finally {
    await db.close();
  }
});

test("deleting an exam keeps the record of reminders sent for it", async () => {
  const db = await setup();
  try {
    const exam = "40000000-0000-4000-8000-000000000001";
    await db.exec(`
      insert into exams(id,user_id,name,exam_at) values('${exam}','${owner}','Finals','2027-01-01');
      insert into notification_log(user_id,kind,exam_id,dedupe_key,title,body,path)
        values('${owner}','lock_in','${exam}','lock_in:${exam}','Finals is tomorrow','One pass tonight.','/exams/${exam}/study');
      delete from exams where id='${exam}';
    `);
    assert.deepEqual((await db.query("select exam_id, kind from notification_log")).rows[0], { exam_id: null, kind: "lock_in" });
  } finally {
    await db.close();
  }
});
