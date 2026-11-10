import test from 'node:test';
import assert from 'node:assert/strict';
import { fullSchema } from './full-schema.mjs';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const deck = '20000000-0000-4000-8000-000000000001';
const card = '30000000-0000-4000-8000-000000000001';

async function asRole(db, role, user = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
  // Fixed test role names only, never request input.
  await db.exec(`set role ${role}`);
}

async function seed(db) {
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',
    [owner, 'owner@example.test', other, 'other@example.test']);
  await db.query('insert into projects(id,user_id,name,deck_name) values($1,$2,$3,$3)', [deck, owner, 'Fixture']);
  await db.query("insert into sources(id,project_id,type) values($1,$1,'text')", [deck]);
  await db.query('insert into generation_jobs(id,source_id) values($1,$1)', [deck]);
  await db.query("insert into cards(id,job_id,type,front,back) values($1,$2,'basic','Question','Answer')", [card, deck]);
}

test('card explanations: explicit grants, owner-only rows, cascade and sync publication', async () => {
  const { db } = await fullSchema({ legacyDefaultGrants: false });
  try {
    const expected = { anon: [], authenticated: ['SELECT', 'INSERT', 'UPDATE'] };
    for (const [role, allowed] of Object.entries(expected)) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const { rows: [result] } = await db.query(
          "select has_table_privilege($1,'public.card_explanations',$2) allowed", [role, privilege]);
        assert.equal(result.allowed, allowed.includes(privilege), `${role} ${privilege}`);
      }
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.card_explanations'::regclass")).rows[0].relrowsecurity, true);
    const published = await db.query(
      "select 1 from pg_publication_tables where pubname='powersync' and tablename='card_explanations'");
    assert.equal(published.rows.length, 1, 'card_explanations syncs through the powersync publication');

    await seed(db);

    await asRole(db, 'authenticated', owner);
    const { rows: [row] } = await db.query(
      "insert into card_explanations(card_id,content_hash,explanation) values($1,'v1:a','{\"gist\":\"x\"}') returning id,user_id",
      [card]);
    assert.equal(row.user_id, owner, 'user_id defaults to the caller');
    assert.equal((await db.query("update card_explanations set hints='{\"0\":[\"h\"]}' where id=$1 returning id", [row.id])).rows.length, 1);
    await assert.rejects(
      db.query("insert into card_explanations(card_id,content_hash) values($1,'v1:b')", [card]),
      /duplicate key|unique/);
    await assert.rejects(db.query('delete from card_explanations where id=$1', [row.id]), /permission denied/);

    await asRole(db, 'authenticated', other);
    assert.equal((await db.query('select * from card_explanations')).rows.length, 0);
    assert.equal((await db.query("update card_explanations set content_hash='forged' where id=$1 returning id", [row.id])).rows.length, 0);
    // Another account cannot attach an explanation to a card it does not own.
    await assert.rejects(
      db.query("insert into card_explanations(card_id,content_hash) values($1,'v1:c')", [card]),
      /row-level security/);

    await asRole(db, 'anon');
    await assert.rejects(db.query('select * from card_explanations'), /permission denied/);

    await db.exec('reset role');
    await db.query('delete from cards where id=$1', [card]);
    assert.equal((await db.query('select * from card_explanations')).rows.length, 0, 'deleting the card removes its explanation');
  } finally {
    await db.close();
  }
});
