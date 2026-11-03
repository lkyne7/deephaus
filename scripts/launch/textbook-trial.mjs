// Full-textbook generation trial against launch staging.
//
// Uploads a PDF as a disposable Pro account, runs hybrid extraction and card
// generation end to end, and writes a report measuring timing, page routing,
// coverage (which pages produced cards), cost and quote fidelity.
//
// Requires a running web server (default http://localhost:3000, `pnpm dev:web`)
// and extraction worker (`pnpm dev:extraction`), both pointed at staging.
//
//   node scripts/launch/textbook-trial.mjs <book.pdf> [--label psych-ch1-2]
//     [--base http://localhost:3000] [--detail low|medium|high]
//     [--timeout-min 120] [--keep]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { root, stagingEnv } from './env.mjs';
import { cleanupTextbookTrial } from './textbook-cleanup.mjs';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: 'string' },
    base: { type: 'string', default: 'http://localhost:3000' },
    detail: { type: 'string', default: 'medium' },
    'timeout-min': { type: 'string', default: '120' },
    keep: { type: 'boolean', default: false },
  },
});
const input = positionals[0];
if (!input) throw new Error('Usage: node scripts/launch/textbook-trial.mjs <book.pdf> [--label name] [--keep]');

const env = stagingEnv();
const require = createRequire(`${root}/apps/web/package.json`);
const { createClient } = require('@supabase/supabase-js');
const label = args.label ?? path.basename(input, '.pdf');
const timeoutMs = Number(args['timeout-min']) * 60_000;
const out = `${root}/test-results/textbook-trial-${label}-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(out, { recursive: true });

const auth = { persistSession: false, autoRefreshToken: false };
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth });
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth });

const report = {
  label, input: path.resolve(input), base: args.base, detail: args.detail,
  startedAt: new Date().toISOString(), timeline: [], checks: [],
};
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const t0 = Date.now();
const elapsed = () => Math.round((Date.now() - t0) / 1000);
function mark(event, details = {}) {
  report.timeline.push({ t: elapsed(), event, ...details });
  console.log(`[${elapsed()}s] ${event} ${JSON.stringify(details)}`);
}
function check(name, passed, details) {
  report.checks.push({ name, passed, details });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(details)}`);
}

let token, userId;
async function api(route, body) {
  const response = await fetch(`${args.base}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
async function single(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
async function allRows(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await single(buildQuery().range(offset, offset + 499));
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
const normalize = text => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

try {
  const bytes = await readFile(input);
  report.fileBytes = bytes.length;

  const email = `textbook-trial-${randomBytes(6).toString('hex')}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  report.userId = userId;
  if (args.keep) report.loginEmail = email;
  // Pro allowance (8,000 credits) so a whole book is not stopped by Basic's 250.
  await single(admin.from('billing_accounts').upsert({
    user_id: userId, plan: 'pro', status: 'active', source: 'textbook-trial',
    environment: 'sandbox', expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  }));
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  token = signed.data.session.access_token;
  await save();

  const project = await api('/api/projects', {
    name: `Textbook trial: ${label}`, deck_name: `Textbook trial: ${label}`, settings: { detailLevel: args.detail },
  });
  report.projectId = project.id;
  const storagePath = `${userId}/${project.id}/${randomBytes(8).toString('hex')}.pdf`;
  const userStorage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const uploaded = await userStorage.storage.from('pdfs').upload(storagePath, bytes, { contentType: 'application/pdf' });
  if (uploaded.error) throw uploaded.error;
  mark('uploaded', { bytes: bytes.length });

  const enqueued = await api('/api/sources/file/enqueue', {
    project_id: project.id, storage_path: storagePath, filename: path.basename(input),
    file_size: bytes.length, mime_type: 'application/pdf', extract_images: true, generate: true,
  });
  const sourceId = enqueued.source.id;
  const extractionJobId = enqueued.extraction_job.id;
  report.sourceId = sourceId;
  report.extractionJobId = extractionJobId;
  mark('extraction enqueued');
  await save();

  // ---- Extraction ---------------------------------------------------------
  let extraction, lastPhase;
  while (true) {
    if (Date.now() - t0 > timeoutMs) throw new Error('Timed out waiting for extraction.');
    extraction = await single(admin.from('source_extraction_jobs').select('*').eq('id', extractionJobId).single());
    const phase = `${extraction.status}/${extraction.phase}`;
    if (phase !== lastPhase) {
      mark('extraction', { phase, progress: extraction.progress, pages: `${extraction.pages_completed ?? 0}/${extraction.pages_total ?? '?'}` });
      lastPhase = phase;
    }
    if (extraction.status === 'ready' || extraction.status === 'failed') break;
    await sleep(3000);
  }
  report.extraction = {
    status: extraction.status, error: extraction.error, attempts: extraction.attempts,
    seconds: Math.round((new Date(extraction.updated_at) - new Date(extraction.created_at)) / 1000),
    pages: extraction.pages_total, quality: extraction.quality_score,
    generationStatus: extraction.generation_status, generationError: extraction.generation_error,
  };
  const pageRows = await allRows(() => admin.from('source_extraction_pages').select('page_number, route, extractor, quality_score').eq('job_id', extractionJobId).order('page_number'));
  report.extraction.routes = pageRows.reduce((acc, row) => ({ ...acc, [row.route]: (acc[row.route] ?? 0) + 1 }), {});
  check('Extraction finished', extraction.status === 'ready', report.extraction);
  await save();
  if (extraction.status !== 'ready') throw new Error(`Extraction failed: ${extraction.error}`);
  if (!extraction.generation_job_id) throw new Error(`Generation did not start: ${extraction.generation_status} ${extraction.generation_error ?? ''}`);

  // ---- Generation ---------------------------------------------------------
  const generationJobId = extraction.generation_job_id;
  report.generationJobId = generationJobId;
  let generation, lastProgress;
  const genStart = Date.now();
  while (true) {
    if (Date.now() - t0 > timeoutMs) throw new Error('Timed out waiting for generation.');
    generation = await single(admin.from('generation_jobs').select('*').eq('id', generationJobId).single());
    const progress = `${generation.status}/${generation.progress}`;
    if (progress !== lastProgress) {
      mark('generation', { status: generation.status, progress: generation.progress });
      lastProgress = progress;
    }
    if (generation.status === 'ready' || generation.status === 'failed') break;
    await sleep(5000);
  }
  const generationSeconds = Math.round((Date.now() - genStart) / 1000);

  // ---- Metrics ------------------------------------------------------------
  const source = await single(admin.from('sources').select('page_count, raw_text').eq('id', sourceId).single());
  const chunks = await allRows(() => admin.from('source_chunks')
    .select('id, chunk_index, page_start, page_end, char_count, content').eq('source_id', sourceId).order('chunk_index'));
  const cards = await allRows(() => admin.from('cards')
    .select('type, front, back, cloze_text, extra, tags, source_ref, source_quote, source_chunk_id')
    .eq('job_id', generationJobId).order('id'));
  const chunkById = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const usedChunks = new Set(cards.map(card => card.source_chunk_id).filter(Boolean));
  const pageCount = source.page_count ?? extraction.pages_total ?? 0;
  const coveredPages = new Set();
  for (const id of usedChunks) {
    const chunk = chunkById.get(id);
    if (chunk?.page_start == null) continue;
    for (let page = chunk.page_start; page <= (chunk.page_end ?? chunk.page_start); page += 1) coveredPages.add(page);
  }
  report.coverageMethod = 'Page ranges of source chunks linked to cards; does not establish coverage of every concept on those pages.';
  const quoted = cards.filter(card => card.source_quote);
  const verbatim = quoted.filter(card => {
    const chunk = chunkById.get(card.source_chunk_id);
    return chunk && normalize(chunk.content).includes(normalize(card.source_quote));
  });
  // Pages are 1-based; report which tenths of the book produced cards.
  const deciles = Array.from({ length: 10 }, (_, d) => {
    const from = Math.floor((d * pageCount) / 10) + 1;
    const to = Math.floor(((d + 1) * pageCount) / 10);
    let covered = 0;
    for (let page = from; page <= to; page += 1) if (coveredPages.has(page)) covered += 1;
    return { pages: `${from}-${to}`, covered: `${covered}/${Math.max(0, to - from + 1)}` };
  });
  const credits = await single(admin.from('ai_credit_transactions')
    .select('action, status, reserved_credits, charged_credits').eq('user_id', userId));

  report.generation = {
    status: generation.status, error: generation.error, seconds: generationSeconds,
    tokenUsage: generation.token_usage, cards: cards.length,
    cardsPer10Pages: pageCount ? Math.round((cards.length / pageCount) * 100) / 10 : null,
    byType: cards.reduce((acc, card) => ({ ...acc, [card.type]: (acc[card.type] ?? 0) + 1 }), {}),
  };
  report.coverage = {
    pageCount, rawTextChars: source.raw_text?.length ?? 0,
    chunks: chunks.length, chunksWithCards: usedChunks.size,
    chunkCoverage: chunks.length ? Math.round((usedChunks.size / chunks.length) * 1000) / 10 : 0,
    pagesWithCards: coveredPages.size,
    pageCoverage: pageCount ? Math.round((coveredPages.size / pageCount) * 1000) / 10 : 0,
    deciles,
    distinctPageStarts: new Set(chunks.map(chunk => chunk.page_start)).size,
  };
  report.quotes = {
    withQuote: quoted.length, verbatim: verbatim.length,
    verbatimRate: quoted.length ? Math.round((verbatim.length / quoted.length) * 1000) / 10 : 0,
  };
  report.credits = credits;
  report.totalSeconds = elapsed();

  check('Generation finished', generation.status === 'ready', report.generation);
  check('Every chunk produced cards', usedChunks.size === chunks.length, report.coverage);
  check('Chunks carry distinct page ranges', report.coverage.distinctPageStarts > Math.min(1, chunks.length - 1), { distinctPageStarts: report.coverage.distinctPageStarts, chunks: chunks.length });
  check('Source quotes are verbatim', report.quotes.verbatimRate >= 90, report.quotes);

  if (report.checks.some(check => !check.passed)) process.exitCode = 1;
  await writeFile(`${out}/cards.json`, JSON.stringify(cards.map(card => ({
    ...card, chunk: chunkById.get(card.source_chunk_id)?.chunk_index ?? null,
    pages: chunkById.has(card.source_chunk_id)
      ? `${chunkById.get(card.source_chunk_id).page_start}-${chunkById.get(card.source_chunk_id).page_end}` : null,
  })), null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(`ERROR ${report.error}`);
  process.exitCode = 1;
} finally {
  if (userId && !args.keep) report.cleanup = await cleanupTextbookTrial(admin, userId);
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(`Report: ${out}/report.json`);
}
