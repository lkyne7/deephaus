import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { root, stagingEnv } from './env.mjs';
import { STAGING_POWERSYNC_URL } from './offline-config.mjs';

const env = stagingEnv({ requireSecret: false });
const native = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
const allowed = new Set(['projects', 'sources', 'generation_jobs', 'cards', 'card_reviews', 'review_logs', 'cram_plans', 'cram_plan_deck_profiles', 'cram_plan_items', 'cram_review_logs', 'user_study_settings', 'user_fsrs_params', 'user_profiles']);
async function login(fixture) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.E2E_EMAIL, password: fixture.E2E_PASSWORD }), signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, 'Staging fixture sign-in failed');
  const session = await response.json();
  assert.equal(session.user.id, fixture.E2E_USER_ID);
  return session.access_token;
}
function stream(token) {
  return fetch(`${STAGING_POWERSYNC_URL}/sync/stream`, {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ buckets: [], include_checksum: true, raw_data: true }), signal: AbortSignal.timeout(60_000),
  });
}
async function snapshot(token) {
  const response = await stream(token);
  assert.equal(response.status, 200, 'PowerSync rejected a valid staging identity');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const rows = new Map();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      assert.ok(!done, 'Stream ended before a complete checkpoint');
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        for (const op of message.data?.data ?? []) {
          const key = `${op.object_type}:${op.object_id}`;
          if (op.op === 'PUT') rows.set(key, { table: op.object_type, id: op.object_id, ...JSON.parse(op.data) });
          else if (op.op === 'REMOVE') rows.delete(key);
          else if (op.op === 'CLEAR') rows.clear();
        }
        if (message.checkpoint_complete) return rows;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
const [ownerToken, nativeToken] = await Promise.all([login(env), login(native)]);
for (const token of [null, `${ownerToken.split('.')[0]}.${Buffer.from(JSON.stringify({ sub: native.E2E_USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${ownerToken.split('.')[2]}`]) {
  const response = await stream(token);
  await response.body?.cancel();
  assert.equal(response.status, 401, 'Missing or forged credentials reached PowerSync');
}
const snapshots = await Promise.all([snapshot(ownerToken), snapshot(nativeToken)]);
for (const [index, fixture] of [env, native].entries()) {
  const rows = snapshots[index];
  const other = index ? env : native;
  assert.ok(rows.has(`projects:${fixture.E2E_DECK_ID}`), 'Own deck was not replicated');
  assert.ok(rows.has(`cards:${fixture.E2E_CARD_ID}`), 'Own card was not replicated');
  assert.ok(!rows.has(`projects:${other.E2E_DECK_ID}`), 'Another account’s deck leaked');
  assert.ok(!rows.has(`cards:${other.E2E_CARD_ID}`), 'Another account’s card leaked');
  for (const row of rows.values()) {
    assert.ok(allowed.has(row.table), 'Unexpected table replicated');
    if (row.user_id) assert.equal(row.user_id, fixture.E2E_USER_ID, 'Cross-account row replicated');
    if (row.table === 'sources') {
      assert.ok(!Object.hasOwn(row, 'raw_text') && !Object.hasOwn(row, 'edited_content'), 'Source body was replicated');
    }
    if (['user_profiles', 'user_study_settings', 'user_fsrs_params'].includes(row.table)) assert.equal(row.id, fixture.E2E_USER_ID);
  }
  console.log(`Staging account ${index + 1}: complete checkpoint, ${rows.size} owned rows, no cross-account data.`);
}
console.log('PowerSync staging gate passed: missing/forged credentials rejected; two isolated libraries replicated.');
