import test from 'node:test';
import assert from 'node:assert/strict';
import { fullSchema } from './full-schema.mjs';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const deck = '20000000-0000-4000-8000-000000000001';

async function asRole(db, role, user = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
  // All callers below use fixed test role names, never request input.
  await db.exec(`set role ${role}`);
}

test('Anki export grants work without automatic public table grants and preserve job-row isolation', async () => {
  const { db } = await fullSchema({ legacyDefaultGrants: false });
  try {
    // Verify the fixture itself cannot hide a missing application GRANT.
    await db.exec('create table public.grant_probe(id integer)');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const { rows: [probe] } = await db.query(
          "select has_table_privilege($1,'public.grant_probe',$2) allowed", [role, privilege]);
        assert.equal(probe.allowed, false, `${role} unexpectedly inherits ${privilege}`);
      }
    }
    await db.exec('drop table public.grant_probe');

    const expected = {
      anon: [],
      authenticated: ['SELECT', 'INSERT', 'UPDATE'],
      service_role: ['SELECT', 'UPDATE'],
    };
    for (const [role, allowed] of Object.entries(expected)) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const { rows: [result] } = await db.query(
          "select has_table_privilege($1,'public.anki_export_jobs',$2) allowed", [role, privilege]);
        assert.equal(result.allowed, allowed.includes(privilege), `${role} ${privilege}`);
      }
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.anki_export_jobs'::regclass")).rows[0].relrowsecurity, true);

    // Fixtures are inserted as the database owner, not by granting extra API access.
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',
      [owner, 'owner@example.test', other, 'other@example.test']);
    await db.query('insert into projects(id,user_id,name,deck_name) values($1,$2,$3,$3)',
      [deck, owner, 'Export fixture']);

    await asRole(db, 'authenticated', owner);
    const { rows: [job] } = await db.query(`
      insert into anki_export_jobs(user_id,project_id,filename)
      values($1,$2,'fixture.apkg') returning id,status`, [owner, deck]);
    assert.equal(job.status, 'pending');
    assert.equal((await db.query('select id from anki_export_jobs')).rows.length, 1);
    assert.equal((await db.query("update anki_export_jobs set phase='loading' where id=$1 returning id", [job.id])).rows.length, 1);
    await assert.rejects(db.query('update anki_export_jobs set user_id=$1 where id=$2', [other, job.id]), /row-level security/);
    await assert.rejects(db.query('delete from anki_export_jobs where id=$1', [job.id]), /permission denied/);
    await assert.rejects(db.query('select claim_anki_export_job()'), /permission denied/);

    await asRole(db, 'authenticated', other);
    assert.equal((await db.query('select id from anki_export_jobs')).rows.length, 0);
    assert.equal((await db.query("update anki_export_jobs set status='failed' where id=$1 returning id", [job.id])).rows.length, 0);
    await assert.rejects(db.query(`insert into anki_export_jobs(user_id,project_id,filename)
      values($1,$2,'forged.apkg')`, [owner, deck]), /row-level security/);

    await asRole(db, 'anon');
    await assert.rejects(db.query('select id from anki_export_jobs'), /permission denied/);
    await assert.rejects(db.query(`insert into anki_export_jobs(user_id,project_id,filename)
      values($1,$2,'anonymous.apkg')`, [owner, deck]), /permission denied/);
    await assert.rejects(db.query("update anki_export_jobs set status='failed'"), /permission denied/);
    await assert.rejects(db.query('select claim_anki_export_job()'), /permission denied/);

    await asRole(db, 'service_role');
    const { rows: [claimed] } = await db.query('select * from claim_anki_export_job()');
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.status, 'processing');
    assert.equal(claimed.attempts, 1);
    assert.equal((await db.query(`update anki_export_jobs set status='ready', progress=100,
      expires_at=now()-interval '1 minute' where id=$1 returning id`, [job.id])).rows.length, 1);
    // The expiry sweep reads jobs and updates them; it never deletes job rows.
    assert.equal((await db.query("select id from anki_export_jobs where status='ready' and expires_at<now()")).rows[0].id, job.id);
    await db.query("update anki_export_jobs set status='expired',storage_path=null where id=$1", [job.id]);

    await asRole(db, 'authenticated', owner);
    assert.equal((await db.query('select status from anki_export_jobs where id=$1', [job.id])).rows[0].status, 'expired');
    await db.exec('reset role');
    await db.query('insert into account_deletion_requests(user_id) values($1)', [owner]);
    await asRole(db, 'authenticated', owner);
    await assert.rejects(db.query("update anki_export_jobs set status='failed' where id=$1", [job.id]), /deletion is in progress/);
    await assert.rejects(db.query(`insert into anki_export_jobs(user_id,project_id,filename)
      values($1,$2,'late.apkg')`, [owner, deck]), /deletion is in progress/);
  } finally { await db.close(); }
});
