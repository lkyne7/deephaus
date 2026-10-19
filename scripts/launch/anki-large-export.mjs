// Trial a large .apkg export end to end against the isolated launch-staging project:
// seed a deck whose cards reference N image objects, run the worker's export
// processor (streaming to scratch disk, resumable upload), download the signed URL
// with progress, verify the archive, exercise expiry, and clean up.
//
// Usage: node scripts/launch/anki-large-export.mjs [--media-count 2560] [--media-bytes 4194304] [--cards 2560]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { root, stagingEnv } from './env.mjs';
import { deleteSyntheticUser } from './delete-user.mjs';
import { processExportJob } from '../../apps/anki-worker/dist/process-export.js';
import { sweepExpiredExports, APKG_EXPORTS_BUCKET } from '../../packages/anki-export/dist/index.js';
import { ApkgArchive, loadCollectionBytes } from '../../apps/anki-worker/dist/zip-reader.js';
import { parseApkgCollectionBytes } from '../../packages/apkg/dist/index.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : Number(process.argv[i + 1]); };
const mediaCount = arg('media-count', 2560);
const mediaBytes = arg('media-bytes', 4 * 1024 * 1024);
const cardCount = arg('cards', mediaCount);
const env = stagingEnv();
const require = createRequire(`${root}/apps/web/package.json`);
const { createClient } = require('@supabase/supabase-js');
const { default_w } = require('ts-fsrs');
const out = `${root}/test-results/anki-large-export-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(out, { recursive: true });
const scratch = `${out}/scratch`;
await mkdir(scratch, { recursive: true });
process.env.ANKI_WORKER_TMPDIR = scratch;
// The worker's export processor reads its storage credentials from the environment.
process.env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const report = { startedAt: new Date().toISOString(), target: env.NEXT_PUBLIC_SUPABASE_URL, mediaCount, mediaBytes, cardCount, checks: [] };
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
function record(name, passed, details) {
  report.checks.push({ name, passed, details });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(details)}`);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let userId, jobId, exportPath, downloadPath;
const mediaPaths = [];
try {
  const email = `launch-large-export-${randomBytes(8).toString('hex')}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: randomBytes(32).toString('base64url'), email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  report.fixtureUserId = userId; await save();

  // Incompressible image bodies so DEFLATE and dedupe cannot shrink the trial.
  const started = Date.now();
  const urls = [];
  let lastLog = 0;
  const uploadOne = async i => {
    const body = Buffer.concat([PNG, randomBytes(mediaBytes - PNG.length)]);
    const path = `${userId}/anki/${randomUUID()}-export-${i}.png`;
    for (let attempt = 1; ; attempt++) {
      const { error } = await admin.storage.from('card-media').upload(path, body, { contentType: 'image/png', upsert: false });
      if (!error) break;
      if (attempt >= 5) throw new Error(`media upload ${i}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
    mediaPaths.push(path);
    urls[i] = admin.storage.from('card-media').getPublicUrl(path).data.publicUrl;
    if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(`Seeded ${mediaPaths.length}/${mediaCount} media (${((Date.now() - started) / 1000).toFixed(0)}s)`); }
  };
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < mediaCount) await uploadOne(next++); }));
  record('Seed media', mediaPaths.length === mediaCount, { objects: mediaPaths.length, bytes: mediaCount * mediaBytes, seconds: (Date.now() - started) / 1000 });

  const project = await admin.from('projects').insert({ user_id: userId, name: 'Large export trial', deck_name: 'Large export trial' }).select('id').single();
  if (project.error) throw project.error;
  const source = await admin.from('sources').insert({ project_id: project.data.id, type: 'apkg', raw_text: 'Large export trial' }).select('id').single();
  if (source.error) throw source.error;
  const generation = await admin.from('generation_jobs').insert({ source_id: source.data.id, status: 'ready', progress: 100 }).select('id').single();
  if (generation.error) throw generation.error;
  for (let i = 0; i < cardCount; i += 500) {
    const rows = Array.from({ length: Math.min(500, cardCount - i) }, (_, j) => ({
      job_id: generation.data.id, type: 'basic', sort_order: i + j, tags: ['large-export'],
      front: `Card ${i + j} <img src="${urls[(i + j) % mediaCount]}">`, back: `Answer ${i + j}`,
    }));
    const { error } = await admin.from('cards').insert(rows);
    if (error) throw error;
  }

  const inserted = await admin.from('anki_export_jobs').insert({ user_id: userId, project_id: project.data.id, include_progress: true, filename: 'Large-export-trial.apkg', status: 'processing', attempts: 1, claimed_at: new Date().toISOString() }).select('*').single();
  if (inserted.error) throw inserted.error;
  jobId = inserted.data.id;
  console.log('Seeded; running the worker export processor.');
  const exportStarted = Date.now();
  let lastPhase = '';
  const progressTimer = setInterval(async () => {
    const { data } = await admin.from('anki_export_jobs').select('phase,progress').eq('id', jobId).single();
    if (data && `${data.phase}:${data.progress}` !== lastPhase) { lastPhase = `${data.phase}:${data.progress}`; console.log(`Export ${data.phase} ${data.progress}% (${((Date.now() - exportStarted) / 1000).toFixed(0)}s)`); }
  }, 10000);
  try { await processExportJob(admin, inserted.data); } finally { clearInterval(progressTimer); }
  const finished = await admin.from('anki_export_jobs').select('*').eq('id', jobId).single();
  if (finished.error) throw finished.error;
  exportPath = finished.data.storage_path;
  const expectedMin = mediaCount * mediaBytes;
  record('Worker export job', finished.data.status === 'ready' && finished.data.result?.mediaBundled === mediaCount && finished.data.file_size >= expectedMin,
    { status: finished.data.status, result: finished.data.result, fileSize: finished.data.file_size, seconds: (Date.now() - exportStarted) / 1000, error: finished.data.error });
  assert.equal(finished.data.status, 'ready');
  const scratchLeft = spawnSync('ls', ['-A', scratch], { encoding: 'utf8' }).stdout.trim();
  record('Scratch file removed after upload', scratchLeft === '', { scratch: scratchLeft });

  // Download through a signed URL, streaming to disk with progress, the way a client would.
  const signed = await admin.storage.from(APKG_EXPORTS_BUCKET).createSignedUrl(exportPath, 3600, { download: finished.data.filename });
  if (signed.error) throw signed.error;
  downloadPath = `${out}/downloaded.apkg`;
  const response = await fetch(signed.data.signedUrl);
  if (!response.ok) throw new Error(`download HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length'));
  const disposition = response.headers.get('content-disposition');
  let received = 0; lastLog = 0;
  const downloadStarted = Date.now();
  await pipeline(Readable.fromWeb(response.body), async function* (chunks) {
    for await (const chunk of chunks) {
      received += chunk.length;
      if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(`Download ${(received / total * 100).toFixed(1)}% (${received}/${total} bytes), ${((Date.now() - downloadStarted) / 1000).toFixed(0)}s`); }
      yield chunk;
    }
  }, createWriteStream(downloadPath));
  record('Signed URL download with progress', received === finished.data.file_size && total === finished.data.file_size && /attachment/.test(disposition ?? ''),
    { bytes: received, contentLength: total, contentDisposition: disposition, seconds: (Date.now() - downloadStarted) / 1000 });

  // Independent archive check (Python's zipfile validates ZIP64 structures) plus the worker's own reader.
  const python = spawnSync('python3', ['-I', '-c', `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = z.namelist()
    bad = z.testzip()
    print(len(names), bad or 'ok', sum(i.file_size for i in z.infolist()))`, downloadPath], { encoding: 'utf8' });
  const [entryCount, integrity, uncompressed] = python.stdout.trim().split(' ');
  record('Archive integrity (zipfile)', python.status === 0 && integrity === 'ok' && Number(entryCount) === mediaCount + 2,
    { entries: entryCount, integrity: integrity ?? python.stderr.trim(), uncompressedBytes: uncompressed });
  const archive = await ApkgArchive.open(downloadPath);
  const parsed = await parseApkgCollectionBytes(await loadCollectionBytes(archive), { fsrsParamCount: default_w.length });
  archive.close();
  record('Worker reader parses exported collection', parsed.stats.cardCount === cardCount, parsed.stats);
  await unlink(downloadPath); downloadPath = null;

  // Expiry: a finished export older than its TTL is swept and its object removed.
  await admin.from('anki_export_jobs').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', jobId);
  const swept = await sweepExpiredExports(admin);
  const after = await admin.from('anki_export_jobs').select('status,storage_path').eq('id', jobId).single();
  const listed = await admin.storage.from(APKG_EXPORTS_BUCKET).list(`${userId}/${jobId}`);
  record('Expired export swept', swept >= 1 && after.data?.status === 'expired' && (listed.data ?? []).length === 0, { swept, status: after.data?.status, objectsLeft: (listed.data ?? []).length });
  if (after.data?.status === 'expired') exportPath = null;
} catch (error) {
  report.error = String(error.message).replaceAll(env.SUPABASE_SERVICE_ROLE_KEY, '[redacted]');
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  if (exportPath) { const r = await admin.storage.from(APKG_EXPORTS_BUCKET).remove([exportPath]); if (r.error) cleanupErrors.push(r.error.message); }
  for (let i = 0; i < mediaPaths.length; i += 500) {
    const r = await admin.storage.from('card-media').remove(mediaPaths.slice(i, i + 500));
    if (r.error) cleanupErrors.push(r.error.message);
  }
  if (userId) cleanupErrors.push(...(await deleteSyntheticUser(admin, userId)).errors);
  if (downloadPath) await unlink(downloadPath).catch(() => {});
  report.cleanup = { mediaRemoved: mediaPaths.length, errors: cleanupErrors }; report.finishedAt = new Date().toISOString();
  await save();
  console.log(`Report: ${out}/report.json`);
  if (cleanupErrors.length || report.checks.some(check => !check.passed)) process.exitCode = 1;
}
