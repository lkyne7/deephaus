import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, stagingEnv } from './env.mjs';
import { runNativeFlow } from './maestro.mjs';

const env = stagingEnv();
const fixture = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
assert.match(fixture.E2E_EMAIL, /^launch-native-[a-f0-9]+@example\.test$/);
const appId = 'com.deephaus.app.staging';
const device = process.env.LAUNCH_SIMULATOR_ID ?? 'booted';
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
const container = simctl('get_app_container', device, appId, 'data');
const executable = `${simctl('get_app_container', device, appId, 'app')}/DeepHaus`;
const storage = path.join(container, 'Library/Application Support', appId, 'RCTAsyncLocalStorage_V1');
const key = `deephaus:draft:${fixture.E2E_USER_ID}:${fixture.E2E_CARD_ID}`;
const draftText = `Native restart ${randomUUID().slice(0, 8)} complete`;
const apiHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
async function call(route, options = {}) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${route}`, { ...options, headers: { ...apiHeaders, ...options.headers }, signal: AbortSignal.timeout(15_000) });
  assert.ok(response.ok, `Staging fixture request failed (${response.status})`);
  return response;
}
const filter = `cards?id=eq.${fixture.E2E_CARD_ID}`;
const rows = await (await call(`${filter}&select=id,back,generation_jobs!inner(sources!inner(user_id,project_id))`)).json();
assert.equal(rows.length, 1);
assert.equal(rows[0].generation_jobs.sources.user_id, fixture.E2E_USER_ID);
assert.equal(rows[0].generation_jobs.sources.project_id, fixture.E2E_DECK_ID);
const originalBack = rows[0].back;
function draft() {
  try {
    const manifest = JSON.parse(readFileSync(path.join(storage, 'manifest.json'), 'utf8'));
    const value = manifest[key];
    if (typeof value === 'string') return JSON.parse(value);
    if (value === null) return JSON.parse(readFileSync(path.join(storage, createHash('md5').update(key).digest('hex')), 'utf8'));
  } catch { /* An atomic replacement may briefly race the observer. */ }
  return null;
}
function localBack() {
  const db = new DatabaseSync(path.join(container, 'Library/deephaus.sqlite'), { readOnly: true });
  try { return db.prepare("SELECT json_extract(data, '$.back') AS back FROM ps_data__cards WHERE id = ?").get(fixture.E2E_CARD_ID)?.back; }
  finally { db.close(); }
}
assert.ok(!draft(), 'Finish any existing fixture draft before starting this destructive process test.');
let killed = false, finished = false;
const values = { APP_ID: appId, E2E_CARD_ID: fixture.E2E_CARD_ID, DRAFT_TEXT: draftText };
const watch = (async () => {
  const deadline = Date.now() + 150_000;
  while (!finished && Date.now() < deadline) {
    if (draft()?.back === draftText) {
      // Resolve the PID from the exact staging bundle, never the user's normal app.
      const processes = execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' });
      const processRow = processes.split('\n').map(row => row.trim().match(/^(\d+)\s+(.+)$/)).find(row => row?.[2] === executable);
      assert.ok(processRow, 'Staging app process was not found');
      process.kill(Number(processRow[1]), 'SIGKILL');
      killed = true;
      assert.notEqual(localBack(), draftText, 'The edit already reached SQLite; this run did not exercise an unsaved draft.');
      assert.equal(draft()?.back, draftText, 'The latest draft did not survive process termination.');
      console.log('Killed the staging app after its latest draft reached disk, before the card save.');
      return;
    }
    await delay(20);
  }
  throw new Error('The target native draft was not observed before the edit flow ended.');
})();
// Observe immediately so a watcher failure cannot become an unhandled rejection.
const observed = watch.then(() => null, error => error);
let successful = false;
try {
  let editError;
  try { await runNativeFlow('.maestro/draft-edit.yaml', values, 'staging-draft-edit'); }
  catch (error) { editError = error; }
  finished = true;
  const observerError = await observed;
  if (observerError) throw observerError;
  assert.ok(killed, editError?.message ?? 'The process was not killed');
  await runNativeFlow('.maestro/draft-restore.yaml', values, 'staging-draft-restore');
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const [card] = await (await call(`${filter}&select=back`)).json();
    if (card.back === draftText && !draft()) { successful = true; break; }
    await delay(500);
  }
  assert.ok(successful, 'Recovered draft did not save and upload');
  assert.equal(localBack(), draftText);
  console.log('PASS: native unsaved edit survived SIGKILL, restored into the editor, and uploaded after restart.');
} finally {
  finished = true;
  await observed;
  // Keep failed drafts for investigation; successful test edits can be cleaned up.
  if (successful) {
    try { simctl('terminate', device, appId); } catch { /* Already stopped by Maestro. */ }
    await call(filter, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ back: originalBack }) });
    simctl('launch', device, appId);
    console.log('Restored the native fixture answer and reopened the staging app.');
  }
}
