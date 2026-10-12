import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { root, stagingEnv } from './env.mjs';
import { ApkgArchive, loadCollectionBytes } from '../../apps/anki-worker/dist/zip-reader.js';
import { parseApkgCollectionBytes } from '../../packages/apkg/dist/index.js';
import { processJob } from '../../apps/anki-worker/dist/process-job.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/launch/anki-large-upload.mjs <synthetic input.apkg>');
const env = stagingEnv();
const require = createRequire(`${root}/apps/web/package.json`);
const { createClient } = require('@supabase/supabase-js');
const tus = require('tus-js-client');
const { default_w } = require('ts-fsrs');
const total = 10 * 1024 ** 3;
const out = `${root}/test-results/anki-large-upload-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(out, { recursive: true });
const filename = `${out}/10gib.apkg`;
const report = { startedAt: new Date().toISOString(), target: env.NEXT_PUBLIC_SUPABASE_URL, bytes: total, fixture: 'ZIP64 with real small collection and unreferenced zero padding', checks: [] };
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
function record(name, passed, details) {
  report.checks.push({ name, passed, details });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(details)}`);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let userId, objectPath, uploadUrl, token;
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function api(path, body) {
  const r = await fetch(`${env.E2E_BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}
try {
  await new Promise((resolve, reject) => {
    const child = spawn('python3', [`${root}/scripts/launch/anki-sparse-fixture.py`, input, filename, String(total)], { stdio: 'inherit' });
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Fixture creation exited ${code}`)));
    child.once('error', reject);
  });
  assert.equal((await stat(filename)).size, total);
  const archive = await ApkgArchive.open(filename);
  const parsed = await parseApkgCollectionBytes(await loadCollectionBytes(archive), { fsrsParamCount: default_w.length });
  archive.close();
  record('Local ZIP64 worker parsing', parsed.stats.cardCount === 6, parsed.stats);
  const email = `launch-large-anki-${randomBytes(8).toString('hex')}@example.test`, password = randomBytes(32).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  token = signed.data.session.access_token;
  const prepared = await api('/api/import/anki/prepare', { filename: '10gib.apkg' });
  objectPath = prepared.storagePath;
  report.fixtureUserId = userId;
  await save();
  let lastLog = 0, resumeTested = false, paused = false, upload;
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filename);
    upload = new tus.Upload(stream, {
      endpoint: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      uploadSize: total, chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${token}`, 'x-upsert': 'true' },
      uploadDataDuringCreation: true, removeFingerprintOnSuccess: true,
      metadata: { bucketName: prepared.bucket, objectName: objectPath, contentType: 'application/octet-stream' },
      onError: error => { stream.destroy(); reject(new Error(`TUS upload failed: ${error.message}`)); },
      onAfterResponse: async (request, response) => {
        // Stop after acknowledged data, then HEAD and resume the same upload.
        if (!paused && request.getMethod() === 'PATCH' && Number(response.getHeader('Upload-Offset')) >= 12 * 1024 ** 2) {
          paused = true;
          const offset = Number(response.getHeader('Upload-Offset'));
          uploadUrl = upload.url;
          await upload.abort();
          const head = await fetch(uploadUrl, { method: 'HEAD', headers: { Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0' }, signal: AbortSignal.timeout(30000) });
          const savedOffset = Number(head.headers.get('upload-offset'));
          assert.equal(head.status, 200); assert.equal(savedOffset, offset);
          record('Interrupted upload retains server offset', true, { acknowledgedBytes: savedOffset });
          resumeTested = true;
          setTimeout(() => upload.start(), 100);
        }
      },
      onProgress: sent => {
        if (Date.now() - lastLog < 15000 && sent < total) return;
        lastLog = Date.now();
        console.log(`Upload ${(sent / total * 100).toFixed(1)}% (${sent}/${total} bytes), ${((Date.now()-started)/1000).toFixed(0)}s`);
      },
      onSuccess: () => { uploadUrl = upload.url; stream.destroy(); resolve(); },
    });
    upload.start();
  });
  const head = await fetch(uploadUrl, { method: 'HEAD', headers: { Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0' }, signal: AbortSignal.timeout(30000) });
  const acknowledged = Number(head.headers.get('upload-offset'));
  record('Full 10 GiB resumable transfer', head.ok && acknowledged === total && resumeTested, { acknowledgedBytes: acknowledged, seconds: (Date.now()-started)/1000, resumeTested });
  assert.equal(acknowledged, total);
  await unlink(filename); // Keep enough disk space for the worker's independent download.
  const queued = await api('/api/import/anki/enqueue', { storage_path: objectPath, filename: '10gib.apkg', file_size: total, scheduling: true });
  assert.equal(queued.inline, false);
  const selected = await admin.from('anki_import_jobs').select('*').eq('id', queued.jobId).eq('user_id', userId).single();
  if (selected.error) throw selected.error;
  // Process only our fixture job; do not claim unrelated staging jobs.
  const changed = await admin.from('anki_import_jobs').update({ status: 'processing', claimed_at: new Date().toISOString(), attempts: 1 }).eq('id', queued.jobId).eq('status', 'pending');
  if (changed.error) throw changed.error;
  console.log('Upload complete; running the actual worker download/import path on the isolated fixture.');
  const workerStarted = Date.now();
  await processJob(admin, selected.data);
  const finished = await admin.from('anki_import_jobs').select('status,result,error').eq('id', queued.jobId).single();
  if (finished.error) throw finished.error;
  record('10 GiB worker download and import', finished.data.status === 'ready' && finished.data.result?.cardsImported === parsed.stats.cardCount && finished.data.result?.scheduledImported === parsed.stats.scheduledCount,
    { ...finished.data, seconds: (Date.now()-workerStarted)/1000 });
} catch (error) {
  // tus errors can include request details. Persist only the message, with credentials removed.
  report.error = String(error.message).replaceAll(token || '__no_token__', '[redacted]').replaceAll(env.SUPABASE_SERVICE_ROLE_KEY, '[redacted]');
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  if (uploadUrl && token) {
    try { await fetch(uploadUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0' }, signal: AbortSignal.timeout(30000) }); } catch { cleanupErrors.push('TUS cleanup request failed'); }
  }
  if (objectPath) { const r = await admin.storage.from('apkg-imports').remove([objectPath]); if (r.error) cleanupErrors.push(r.error.message); }
  if (userId) { const r = await admin.auth.admin.deleteUser(userId); if (r.error) cleanupErrors.push(r.error.message); }
  await unlink(filename).catch(() => {});
  report.cleanup = { errors: cleanupErrors }; report.finishedAt = new Date().toISOString();
  await save();
  console.log(`Report: ${out}/report.json`);
  if (cleanupErrors.length || report.checks.some(check => !check.passed)) process.exitCode = 1;
}
