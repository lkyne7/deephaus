import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { root, stagingEnv } from './env.mjs';
import { runNativeFlow } from './maestro.mjs';

const fixture = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
assert.match(fixture.E2E_EMAIL, /^launch-native-[a-f0-9]+@example\.test$/);
const env = stagingEnv({ requireSecret: false });
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
assert.ok(['http://localhost:3000', 'http://localhost:3100'].includes(base));
const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: fixture.E2E_EMAIL, password: fixture.E2E_PASSWORD }),
});
assert.ok(response.ok, 'Native fixture authentication failed');
const session = await response.json();
const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
async function settings(patch) {
  const res = await fetch(`${base}/api/fsrs/settings`, {
    headers, ...(patch ? { method: 'PATCH', body: JSON.stringify(patch) } : {}),
  });
  assert.ok(res.ok, `Study settings returned ${res.status}`);
  return res.json();
}
const original = await settings();
try {
  await settings({ easyDays: Array(7).fill('normal') });
  await runNativeFlow('.maestro/easy-days.yaml', {
    APP_ID: 'com.deephaus.app.staging', E2E_EMAIL: fixture.E2E_EMAIL,
  }, 'staging-easy-days');
  const saved = await settings();
  assert.deepEqual(saved.easyDays, ['normal', 'normal', 'minimum', 'normal', 'normal', 'reduced', 'reduced']);
  const container = execFileSync('xcrun', ['simctl', 'get_app_container', process.env.LAUNCH_SIMULATOR_ID ?? 'booted', 'com.deephaus.app.staging', 'data'], { encoding: 'utf8' }).trim();
  const db = new DatabaseSync(path.join(container, 'Library/deephaus.sqlite'), { readOnly: true });
  try {
    let actual;
    for (let attempt = 0; attempt < 10; attempt++) {
      const row = db.prepare('SELECT data FROM ps_data__user_study_settings WHERE id = ?').get(fixture.E2E_USER_ID);
      const raw = row ? JSON.parse(row.data).easy_days : null;
      actual = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (JSON.stringify(actual) === JSON.stringify(saved.easyDays)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.deepEqual(actual, saved.easyDays, 'Native offline replica must match saved Easy Days');
  } finally { db.close(); }
  console.log('PASS: native preset, custom weekday, save, restart persistence, server readback, and offline replica.');
} finally {
  await settings({ easyDays: original.easyDays ?? Array(7).fill('normal'), timezone: original.timezone });
  await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  });
}
