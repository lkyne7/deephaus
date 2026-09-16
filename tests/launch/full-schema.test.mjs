import test from 'node:test';
import assert from 'node:assert/strict';
import { fullSchema } from './full-schema.mjs';
import { readFile } from 'node:fs/promises';

test('staging acceptance SQL passes locally and rolls back all fixture data', async () => {
  const { db } = await fullSchema();
  try {
    await db.exec(await readFile(new URL('../../supabase/tests/launch_acceptance.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select * from auth.users')).rows.length,0);
  } finally { await db.close(); }
});

test('complete migration history installs with launch flags disabled', async () => {
  const { db, migrations } = await fullSchema();
  try {
    assert.ok(migrations.length > 50);
    assert.deepEqual((await db.query('select name,enabled from launch_features')).rows,
      [{ name: 'review_reconciliation', enabled: false }]);
  } finally { await db.close(); }
});

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const deck = '20000000-0000-4000-8000-000000000001';

async function seed(db) {
  await db.exec(`
    insert into auth.users(id,email) values('${owner}','owner@example.test'),('${other}','other@example.test');
    insert into projects(id,user_id,name,deck_name) values('${deck}','${owner}','Fixture','Fixture');
    insert into sources(id,project_id,type) values('${deck}','${deck}','text');
    insert into generation_jobs(id,source_id) values('${deck}','${deck}');
    insert into cards(id,job_id,type,front,back) values('${deck}','${deck}','basic','Question','Answer');
  `);
}
async function asUser(db, id) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false);
    select set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`);
}

test('full-schema RLS isolates library reads, writes, rollout and storage between accounts', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    await asUser(db, owner);
    assert.equal((await db.query('select * from cards')).rows.length, 1);
    await db.query("insert into storage.objects(bucket_id,name) values('card-media',$1)", [`${owner}/image.png`]);
    await asUser(db, other);
    for (const table of ['projects','sources','generation_jobs','cards','card_reviews','review_events','account_deletion_requests'])
      assert.equal((await db.query(`select * from ${table}`)).rows.length, 0, table);
    assert.equal((await db.query('update cards set front=$1 where id=$2 returning id', ['Forged',deck])).rows.length, 0);
    await assert.rejects(db.query('insert into projects(user_id,name,deck_name) values($1,$2,$2)', [owner,'Forged']), /row-level security/);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('card-media',$1)", [`${owner}/forged.png`]), /row-level security/);
    await assert.rejects(db.query("insert into launch_feature_users values('review_reconciliation',$1)", [other]), /row-level security|permission denied/);
    assert.equal((await db.query("update launch_features set enabled=true returning name")).rows.length, 0);
    await db.exec('reset role');
    assert.equal((await db.query('select front from cards')).rows[0].front,'Question');
    assert.equal((await db.query('select enabled from launch_features')).rows[0].enabled,false);
  } finally { await db.close(); }
});

test('all revised dashboard SQL functions execute against the complete schema', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    await asUser(db, owner);
    const queries = [
      'select * from get_study_deck_summaries($1,now(),current_date::timestamptz)',
      'select * from get_dashboard_queue_snapshot($1,now(),current_date::timestamptz)',
      "select * from get_user_study_days($1,now()-interval '1 year')",
      "select * from get_dashboard_metrics($1,now(),current_date::timestamptz,now()-interval '30 days',now()-interval '1 year')",
    ];
    for (const sql of queries) await db.query(sql,[owner]);
    assert.equal(Number((await db.query('select count_new_reviews_today_for_deck($1,$2,current_date::timestamptz) n',[deck,owner])).rows[0].n),0);
  } finally { await db.close(); }
});

test('deletion fences actual library and storage writes while leaving another account usable', async () => {
  const { db } = await fullSchema();
  try {
    await seed(db);
    await db.query('insert into account_deletion_requests(user_id) values($1)',[owner]);
    await asUser(db, owner);
    await assert.rejects(db.query('update cards set front=$1 where id=$2',['Blocked',deck]), /deletion is in progress/);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('card-media',$1)",[`${owner}/late-upload.png`]), /deletion is in progress/);
    await asUser(db, other);
    await db.query('insert into projects(user_id,name,deck_name) values($1,$2,$2)',[other,'Allowed']);
    assert.equal((await db.query('select * from projects')).rows.length,1);
  } finally { await db.close(); }
});
