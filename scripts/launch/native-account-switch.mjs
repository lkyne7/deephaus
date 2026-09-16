import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { root, stagingEnv } from './env.mjs';
import { runNativeFlow } from './maestro.mjs';

const env = stagingEnv({ requireSecret: false });
const a = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
assert.match(a.E2E_EMAIL, /^launch-native-[a-f0-9]+@example\.test$/);
assert.match(env.E2E_OTHER_EMAIL, /^launch-other-[a-f0-9]+@example\.test$/);
const b = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('E2E_OTHER_')).map(([key, value]) => [key.replace('E2E_OTHER_', 'E2E_'), value]));
const appId = 'com.deephaus.app.staging';
const device = process.env.LAUNCH_SIMULATOR_ID ?? 'booted';
const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, appId, 'data'], { encoding: 'utf8' }).trim();
const mediaDirectory = path.join(container, 'Documents/study-media', a.E2E_USER_ID);
const savedMedia = readdirSync(mediaDirectory).sort();
assert.equal(savedMedia.length, 1, 'Run the native media download gate first.');
const login = (account, name) => runNativeFlow('.maestro/launch.yaml', { APP_ID: appId, E2E_EMAIL: account.E2E_EMAIL, E2E_PASSWORD: account.E2E_PASSWORD, E2E_DECK_NAME: account.E2E_DECK_NAME }, name);
async function verifyReplica(account, other) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const db = new DatabaseSync(path.join(container, 'Library/deephaus.sqlite'), { readOnly: true });
    try {
      const own = db.prepare('SELECT id FROM ps_data__cards WHERE id = ?').get(account.E2E_CARD_ID);
      if (own) {
        assert.ok(!db.prepare('SELECT id FROM ps_data__cards WHERE id = ?').get(other.E2E_CARD_ID), 'Previous account’s card remains in the active replica');
        const owners = db.prepare("SELECT DISTINCT json_extract(data, '$.user_id') AS owner FROM ps_data__projects").all();
        assert.ok(owners.length > 0 && owners.every(row => row.owner === account.E2E_USER_ID), 'Cross-account project in the active replica');
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ps_crud').get().count, 0);
        return;
      }
    } finally { db.close(); }
    await delay(500);
  }
  throw new Error('The selected account’s library did not finish syncing');
}
try {
  await login(b, 'staging-account-b');
  await runNativeFlow('.maestro/account-isolation.yaml', { APP_ID: appId, E2E_DECK_NAME: b.E2E_DECK_NAME, OTHER_DECK_NAME: a.E2E_DECK_NAME, OTHER_CARD_ID: a.E2E_CARD_ID }, 'staging-account-isolation');
  await verifyReplica(b, a);
  console.log('Account B sees only its own library; account A’s card is unavailable and absent from SQLite.');
} finally {
  await login(a, 'staging-account-a-restored');
  await verifyReplica(a, b);
  assert.deepEqual(readdirSync(mediaDirectory).sort(), savedMedia, 'Account A’s downloaded media was unexpectedly discarded');
  console.log('Account A’s library and existing downloaded media restored; account B’s rows are absent.');
}
console.log('PASS: native account switching, foreign-card rejection, replica ownership, and retained account-scoped downloads.');
