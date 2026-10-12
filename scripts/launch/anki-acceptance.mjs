import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { stagingEnv, root } from './env.mjs';
import { deleteSyntheticUser } from './delete-user.mjs';
import { buildApkg, parseApkg } from '../../packages/apkg/dist/index.js';
import { getSql } from '../../packages/apkg/dist/sql.js';

// Explicitly pinned to the isolated launch environment by stagingEnv().
const env = stagingEnv();
const require = createRequire(`${root}/apps/web/package.json`);
const JSZip = require('jszip');
const { createClient } = require('@supabase/supabase-js');
const { default_w } = require('ts-fsrs');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const out = `${root}/test-results/anki-acceptance-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), target: env.NEXT_PUBLIC_SUPABASE_URL, checks: [] };
const record = (name, passed, details) => {
  report.checks.push({ name, passed, details });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(details)}`);
};
function rows(db, sql) {
  const result = db.exec(sql)[0];
  return result ? result.values.map(values => Object.fromEntries(result.columns.map((key, i) => [key, values[i]]))) : [];
}
const cards = ['new', 'learning', 'review', 'relearning', 'suspended'].map(name => ({
  type: 'basic', front: `Acceptance ${name}`, back: `Answer ${name}`, tags: ['acceptance'],
}));
cards.push({ type: 'cloze', clozeText: 'Acceptance {{c1::first}} and {{c2::second}}', extra: 'Two schedules', tags: ['acceptance'] });
const generated = await buildApkg({ deckName: 'Anki acceptance synthetic fixture', cards });
const zip = await JSZip.loadAsync(generated.bytes);
const SQL = await getSql();
const db = new SQL.Database(await zip.file('collection.anki2').async('uint8array'));
const nowSeconds = Math.floor(Date.now() / 1000);
const crt = Math.floor(nowSeconds / 86400) * 86400 - 100 * 86400;
db.run('update col set crt = ?', [crt]);
const schedules = {
  new: [0, 0, 1, 0, 2500, 0, 0, ''],
  learning: [1, 1, nowSeconds + 600, -600, 2500, 2, 0, ''],
  review: [2, 2, 110, 20, 2500, 17, 2, JSON.stringify({ s: 23.5, d: 4.2 })],
  relearning: [3, 3, 101, 1, 2200, 9, 3, JSON.stringify({ s: 2.5, d: 6.1 })],
  suspended: [2, -1, 107, 14, 2100, 25, 5, JSON.stringify({ s: 15.2, d: 7.3 })],
};
for (const card of rows(db, 'select cards.id, cards.ord, notes.flds from cards join notes on notes.id=cards.nid order by cards.id')) {
  const name = Object.keys(schedules).find(key => card.flds.startsWith(`Acceptance ${key}\u001f`));
  const values = name ? schedules[name] : [2, 2, 104 + card.ord, 7 + card.ord, 2500, 8 + card.ord, card.ord, JSON.stringify({ s: 10 + card.ord, d: 5 + card.ord })];
  db.run('update cards set type=?, queue=?, due=?, ivl=?, factor=?, reps=?, lapses=?, data=? where id=?', [...values, card.id]);
  if (values[5]) db.run('insert into revlog (id,cid,usn,ease,ivl,lastIvl,factor,time,type) values (?,?,?,?,?,?,?,?,?)',
    [nowSeconds * 1000 + Number(card.id) % 100000, card.id, -1, 3, values[3], 1, 2500, 1200, 1]);
}
report.fixture = { notes: rows(db, 'select count(*) as n from notes')[0].n,
  cards: rows(db, 'select count(*) as n from cards')[0].n,
  historyEvents: rows(db, 'select count(*) as n from revlog')[0].n,
  schedules: rows(db, 'select type,queue,due,ivl,reps,lapses,data,ord from cards order by id') };
zip.file('collection.anki2', db.export());
db.close();
const bytes = await zip.generateAsync({ type: 'uint8array' });
await writeFile(`${out}/input.apkg`, bytes);
const parsed = await parseApkg(bytes, { fsrsParamCount: default_w.length });
report.parsed = parsed.stats;
const byFront = front => parsed.decks.flatMap(d => d.cards).find(c => c.front === front);
assert.equal(byFront('Acceptance new').reviews.length, 0);
for (const name of ['learning', 'review', 'relearning', 'suspended']) {
  const [type, queue, due, interval, , reps, lapses, data] = schedules[name];
  const review = byFront(`Acceptance ${name}`).reviews[0];
  assert.equal(review.fields.state, type);
  assert.equal(review.fields.suspended, queue === -1);
  assert.equal(review.fields.reps, reps);
  assert.equal(review.fields.lapses, lapses);
  assert.equal(Date.parse(review.fields.due), (due > 1e9 ? due : crt + due * 86400) * 1000);
  assert.ok(Math.abs(review.fields.scheduled_days - (interval < 0 ? -interval / 86400 : interval)) < 1e-10);
  if (data) { const memory = JSON.parse(data); assert.equal(review.fields.stability, memory.s); assert.equal(review.fields.difficulty, memory.d); }
}
const clozeReviews = parsed.decks.flatMap(d => d.cards).find(c => c.type === 'cloze').reviews;
assert.deepEqual(clozeReviews.map(r => [r.clozeOrd, r.fields.stability, r.fields.difficulty, r.fields.reps]), [[1, 10, 5, 8], [2, 11, 6, 9]]);
record('Fixture parser matches independent schedules', true, { newCards: 1, scheduledStates: 6, clozeSchedules: 2 });
let userId, accessToken;
const objects = [];
async function api(route, body, multipart = false) {
  const res = await fetch(`${env.E2E_BASE_URL}${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status} ${await res.text()}`);
  return res;
}
try {
  const email = `launch-anki-${randomBytes(8).toString('hex')}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  accessToken = signedIn.data.session.access_token;
  const prepared = await (await api('/api/import/anki/prepare', { filename: '10gib-acceptance.apkg' })).json();
  objects.push(prepared.storagePath);
  const size = 10 * 1024 ** 3;
  assert.equal(prepared.maxApkgBytes, size);
  const metadata = { bucketName: prepared.bucket, objectName: prepared.storagePath, contentType: 'application/octet-stream', cacheControl: '3600' };
  const endpoint = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`;
  const response = await fetch(endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${accessToken}`, apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Tus-Resumable': '1.0.0', 'Upload-Length': String(size),
    'Upload-Metadata': Object.entries(metadata).map(([k,v]) => `${k} ${Buffer.from(v).toString('base64')}`).join(','),
  }, signal: AbortSignal.timeout(30000) });
  const location = response.headers.get('location');
  const responseBody = await response.text();
  record('10 GiB upload creation', response.status === 201, { bytes: size, httpStatus: response.status, response: responseBody, fullTransferTested: false });
  if (location) {
    const terminated = await fetch(new URL(location, endpoint), { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Tus-Resumable': '1.0.0' }, signal: AbortSignal.timeout(30000) });
    report.preflightTerminationStatus = terminated.status;
  }
  const form = new FormData();
  form.set('file', new Blob([bytes]), 'progress-fixture.apkg');
  form.set('scheduling', 'true');
  const imported = await (await api('/api/import/anki', form, true)).json();
  report.importResult = imported;
  const { data: stored, error } = await admin.from('card_reviews').select('*,cards(front,cloze_text)').eq('user_id', userId);
  if (error) throw error;
  const expected = parsed.decks.flatMap(d => d.cards.flatMap(c => c.reviews.map(r => ({ front: c.front, cloze: c.clozeText, ...r }))));
  const mismatches = [];
  for (const e of expected) {
    const actual = stored.find(r => r.cloze_ord === e.clozeOrd && (e.front ? r.cards.front === e.front : r.cards.cloze_text === e.cloze));
    if (!actual) { mismatches.push({ front: e.front, clozeOrd: e.clozeOrd, missing: true }); continue; }
    for (const field of ['state','reps','lapses','scheduled_days','stability','difficulty','suspended']) {
      const want = e.fields[field], got = actual[field];
      const equal = typeof want === 'number' && typeof got === 'number' ? Math.abs(want - got) < 1e-10 : want === got;
      if (!equal) mismatches.push({ front: e.front, field, expected: want, actual: got });
    }
    if (Math.abs(Date.parse(actual.due) - Date.parse(e.fields.due)) > 1000) mismatches.push({ front: e.front, field: 'due' });
  }
  record('Scheduling state import', stored.length === expected.length && !mismatches.length, { expected: expected.length, actual: stored.length, mismatches });
  const history = await admin.from('review_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (history.error) throw history.error;
  record('Historical review log import', history.count === report.fixture.historyEvents, { expected: report.fixture.historyEvents, actual: history.count });
  const exported = await api('/api/export', { project_id: imported.decks[0].id });
  const exportedBytes = new Uint8Array(await exported.arrayBuffer());
  await writeFile(`${out}/exported.apkg`, exportedBytes);
  const roundtrip = await parseApkg(exportedBytes, { fsrsParamCount: default_w.length });
  const exportedZip = await JSZip.loadAsync(exportedBytes);
  const exportedDb = new SQL.Database(await exportedZip.file('collection.anki2').async('uint8array'));
  report.exported = { ...roundtrip.stats, historyEvents: rows(exportedDb, 'select count(*) as n from revlog')[0].n,
    schedules: rows(exportedDb, 'select type,queue,due,ivl,reps,lapses,data,ord from cards order by id') };
  exportedDb.close();
  const contentSnapshot = value => value.decks.flatMap(d => d.cards).map(c => JSON.stringify({
    type: c.type, front: c.front, back: c.back, clozeText: c.clozeText, extra: c.extra, tags: [...c.tags].sort(),
  })).sort();
  const contentPreserved = JSON.stringify(contentSnapshot(roundtrip)) === JSON.stringify(contentSnapshot(parsed));
  record('Card content export', contentPreserved, { expected: parsed.stats.cardCount, actual: roundtrip.stats.cardCount, fieldsAndTagsEqual: contentPreserved });
  record('Scheduling state export', roundtrip.stats.scheduledCount === parsed.stats.scheduledCount,
    { expected: parsed.stats.scheduledCount, actual: roundtrip.stats.scheduledCount, suspendedExpected: parsed.stats.suspendedCount, suspendedActual: roundtrip.stats.suspendedCount });
  record('Historical review log export', report.exported.historyEvents === report.fixture.historyEvents,
    { expected: report.fixture.historyEvents, actual: report.exported.historyEvents });
  const roundtripForm = new FormData();
  roundtripForm.set('file', new Blob([exportedBytes]), 'exported-roundtrip.apkg');
  roundtripForm.set('scheduling', 'true');
  const reimported = await (await api('/api/import/anki', roundtripForm, true)).json();
  record('Import/export/reimport preserves progress', reimported.scheduledImported === imported.scheduledImported && reimported.suspendedImported === imported.suspendedImported,
    { scheduledBefore: imported.scheduledImported, scheduledAfter: reimported.scheduledImported, suspendedBefore: imported.suspendedImported, suspendedAfter: reimported.suspendedImported });
  const freshForm = new FormData(); freshForm.set('file', new Blob([bytes]), 'fresh-fixture.apkg'); freshForm.set('scheduling', 'false');
  const fresh = await (await api('/api/import/anki', freshForm, true)).json();
  record('Import without scheduling', fresh.scheduledImported === 0 && fresh.cardsImported === parsed.stats.cardCount, fresh);
} catch (error) {
  report.error = error.message; console.error(error.message); process.exitCode = 1;
} finally {
  if (userId) {
    const cleanupErrors = [];
    if (objects.length) { const result = await admin.storage.from('apkg-imports').remove(objects); if (result.error) cleanupErrors.push(result.error.message); }
    const result = await deleteSyntheticUser(admin, userId);
    cleanupErrors.push(...result.errors);
    report.cleanup = { userDeleted: result.userDeleted, errors: cleanupErrors };
    if (cleanupErrors.length) process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(`Report: ${out}/report.json`);
  if (report.checks.some(check => !check.passed)) process.exitCode = 1;
}
