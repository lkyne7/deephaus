import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { root } from './env.mjs';

const fixture = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
assert.match(fixture.E2E_EMAIL, /^launch-native-[a-f0-9]+@example\.test$/);
const container = execFileSync('xcrun', ['simctl', 'get_app_container', process.env.LAUNCH_SIMULATOR_ID ?? 'booted', 'com.deephaus.app.staging', 'data'], { encoding: 'utf8' }).trim();
const db = new DatabaseSync(path.join(container, 'Library/deephaus.sqlite'), { readOnly: true });
try {
  assert.ok(db.prepare('SELECT id FROM ps_data__projects WHERE id = ?').get(fixture.E2E_DECK_ID), 'Native deck missing from SQLite');
  assert.ok(db.prepare('SELECT id FROM ps_data__cards WHERE id = ?').get(fixture.E2E_CARD_ID), 'Native card missing from SQLite');
  const owners = db.prepare("SELECT DISTINCT json_extract(data, '$.user_id') AS owner FROM ps_data__projects").all();
  assert.ok(owners.every(row => row.owner === fixture.E2E_USER_ID), 'Another account’s project is present');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ps_crud').get().count, 0, 'Native upload queue has unfinished work');
} finally { db.close(); }
const manifestPath = path.join(container, 'Library/Application Support/com.deephaus.app.staging/RCTAsyncLocalStorage_V1/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const prefix = `deephaus:media:${fixture.E2E_USER_ID}`;
const keys = Object.keys(manifest).filter(key => key.startsWith(prefix));
assert.ok(keys.length > 0, 'Account-scoped native manifest missing');
const expected = createHash('sha256').update(readFileSync(path.join(root, 'apps/web/public/icon-192.png'))).digest('hex');
const directory = path.join(container, 'Documents/study-media', fixture.E2E_USER_ID);
const files = readdirSync(directory);
assert.equal(files.length, 1, 'Native fixture should have one managed image');
assert.equal(createHash('sha256').update(readFileSync(path.join(directory, files[0]))).digest('hex'), expected, 'Downloaded bytes do not match the fixture image');
console.log('Native persistence passed: owned SQLite library, empty upload queue, account-scoped manifest, and exact downloaded image bytes.');
