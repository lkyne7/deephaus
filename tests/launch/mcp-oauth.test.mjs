import test from 'node:test';
import assert from 'node:assert/strict';
import { fullSchema } from './full-schema.mjs';

const user = '30000000-0000-4000-8000-000000000001';
const resource = 'https://app.test/api/mcp';
async function fixture(t) {
  const { db } = await fullSchema();
  t.after(() => db.close());
  await db.query('insert into auth.users(id,email) values($1,$2)', [user, 'mcp@example.test']);
  const { rows: [access] } = await db.query(`insert into api_tokens(user_id,name,token_prefix,token_hash,scopes,kind,client_id,resource)
    values($1,'MCP','dh_test','old-access',array['study','write'],'oauth','client',$2) returning id`, [user, resource]);
  await db.query(`insert into oauth_refresh_tokens(user_id,token_hash,client_id,client_name,scopes,api_token_id,resource,expires_at)
    values($1,'old-refresh','client','MCP',array['study','write'],$2,$3,now()+interval '1 day')`, [user, access.id, resource]);
  return db;
}
async function rotate(db, options = {}) {
  const { rows } = await db.query('select rotate_oauth_refresh_token($1,$2,$3,$4,$5,$6,$7) result', [
    options.token ?? 'old-refresh', options.client ?? 'client', options.resource ?? resource,
    options.scopes ?? null, options.access ?? 'new-access', 'dh_new', options.refresh ?? 'new-refresh',
  ]);
  return rows[0].result;
}

test('OAuth rotation binds audience, narrows scope, and replay revokes the replacement', async (t) => {
  const db = await fixture(t);
  assert.deepEqual(await rotate(db, { scopes: ['study'] }), { ok: true, scopes: ['study'] });
  const { rows: [access] } = await db.query("select resource,scopes,revoked_at from api_tokens where token_hash='new-access'");
  assert.equal(access.resource, resource);
  assert.deepEqual(access.scopes, ['study']);
  assert.equal(access.revoked_at, null);
  assert.equal((await rotate(db)).error, 'invalid_grant');
  assert.equal((await db.query('select id from api_tokens where revoked_at is null')).rows.length, 0);
  assert.equal((await db.query('select id from oauth_refresh_tokens where revoked_at is null')).rows.length, 0);
});

test('wrong clients, audiences and broader scopes cannot consume a refresh token', async (t) => {
  const db = await fixture(t);
  assert.equal((await rotate(db, { client: 'other' })).error, 'invalid_grant');
  assert.equal((await rotate(db, { resource: 'https://other.test/api/mcp' })).error, 'invalid_grant');
  assert.equal((await rotate(db, { scopes: ['admin'] })).error, 'invalid_scope');
  assert.equal((await rotate(db, { scopes: [] })).error, 'invalid_scope');
  assert.equal((await db.query("select revoked_at from oauth_refresh_tokens where token_hash='old-refresh'")).rows[0].revoked_at, null);
  assert.equal((await rotate(db)).ok, true);
});

test('grant revocation prevents refresh and RPCs are not callable by browser roles', async (t) => {
  const db = await fixture(t);
  await db.query('select revoke_oauth_grant($1,$2)', [user, 'client']);
  assert.equal((await rotate(db)).error, 'invalid_grant');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(rotate(db), /permission denied/);
    await assert.rejects(db.query('select revoke_oauth_grant($1,$2)', [user, 'client']), /permission denied/);
    await db.exec('reset role');
  }
});

test('expired and legacy unbound refresh tokens require reconnecting', async (t) => {
  const db = await fixture(t);
  await db.exec("update oauth_refresh_tokens set expires_at = now() - interval '1 day'");
  assert.equal((await rotate(db)).error, 'invalid_grant');
  await db.exec("update oauth_refresh_tokens set expires_at = now() + interval '1 day', resource = null");
  assert.equal((await rotate(db)).error, 'invalid_grant');
});
