/**
 * Compare card-generation models on the same source chunks.
 *
 * Every model gets the production prompt, schema and validation from
 * src/generate.ts, so the cards are what users would see. The script writes an
 * HTML report with the cards side by side plus cost, speed and quote checks.
 *
 *   pnpm --filter @deephaus/llm compare-models -- <book.pdf|notes.txt|notes.md>
 *     [--pages 20-80] [--chunks 8] [--types basic,cloze] [--detail medium]
 *     [--models gpt-5.4-mini,claude-haiku-5-5@low] [--blind] [--label name] [--density-scale 2]
 *     [--env-file ../../apps/web/.env.local] [--out ../../test-results/...]
 *
 * A model spec is `<model id>[@<reasoning effort>]`. Ids starting with
 * `claude-` go to Anthropic, everything else to OpenAI. Keys come from
 * OPENAI_API_KEY and ANTHROPIC_API_KEY in the environment or the env files.
 */
import { randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { extractLocalPages, inspectPdf } from "@deephaus/pdf-extraction";
import {
  chunkPdfPageEntries,
  chunkText,
  deduplicateCards,
  escapeHtml,
  parseGenerationSettings,
  type GeneratedCard,
  type GenerationSettings,
  type TextChunk,
} from "@deephaus/shared";
import {
  GENERATED_CARDS_JSON_SCHEMA,
  avoidWithEarlierPasses,
  chunkCardPrompt,
  chunkGenerationPasses,
  parseChunkCards,
  type GenerateChunkOptions,
} from "../src/generate.js";
import {
  REPO_ROOT,
  addUsage,
  callJson,
  costOf,
  createClients,
  emptyUsage,
  fromCaller,
  loadEnvFiles,
  mapLimit,
  parseModelSpec,
  type Clients,
  type ModelSpec,
  type Usage,
} from "./model-clients.js";

const DEFAULT_MODELS = [
  "gpt-5.4-mini",
  "gpt-6-luna@low",
  "gpt-6-luna@medium",
  "gpt-6.1-terra@low",
  "claude-haiku-5-5@low",
  "claude-haiku-5-5@medium",
  "claude-sonnet-5-5@medium",
  "gpt-6.1-sol@low",
  "claude-opus-5-5@low",
];

const CONCURRENCY_PER_MODEL = 4;

const MIN_CHUNK_CHARS = 1500;

interface ChunkResult {
  cards: GeneratedCard[];
  rejected: number;
  errors: string[];
  latencyMs: number[];
  usage: Usage;
}

async function runModel(
  spec: ModelSpec,
  chunks: TextChunk[],
  settings: GenerationSettings,
  passes: GenerateChunkOptions[],
  clients: Clients,
  onDone: () => void,
): Promise<ChunkResult[]> {
  const results: ChunkResult[] = chunks.map(() => ({
    cards: [],
    rejected: 0,
    errors: [],
    latencyMs: [],
    usage: emptyUsage(),
  }));
  await mapLimit(chunks, CONCURRENCY_PER_MODEL, async (chunk, index) => {
    const result = results[index]!;
    for (const pass of passes) {
      // Same pass chaining as generateCardsFromChunks in production.
      const prompt = chunkCardPrompt(chunk, settings, { ...pass, avoid: avoidWithEarlierPasses(undefined, result.cards) });
      const call = await callJson(clients, spec, {
        system: prompt.system,
        user: prompt.user,
        schemaName: "flashcards",
        schema: GENERATED_CARDS_JSON_SCHEMA,
        // Production sends temperature 0.3 to models without reasoning effort.
        temperature: 0.3,
      });
      addUsage(result.usage, call.usage);
      result.latencyMs.push(call.latencyMs);
      if (call.error) {
        result.errors.push(call.error);
        continue;
      }
      const parsed = parseChunkCards(call.content ?? "", chunk, settings, pass);
      if (parsed.apiError) result.errors.push(parsed.apiError);
      result.rejected += parsed.rejected;
      result.cards.push(...parsed.cards);
    }
    result.cards = deduplicateCards(result.cards);
    onDone();
  });
  return results;
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”"'`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteFound(card: GeneratedCard, chunk: TextChunk): boolean | undefined {
  if (!card.sourceQuote) return undefined;
  return normalizeForMatch(chunk.text).includes(normalizeForMatch(card.sourceQuote));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pickChunks(chunks: TextChunk[], count: number): TextChunk[] {
  const usable = chunks.filter((chunk) => chunk.text.length >= MIN_CHUNK_CHARS);
  const pool = usable.length > 0 ? usable : chunks;
  if (pool.length <= count) return pool;
  return Array.from({ length: count }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (count - 1 || 1))]!);
}

function parsePageRange(raw: string | undefined, total: number): number[] {
  if (!raw) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of raw.split(",")) {
    const [start, end] = part.split("-").map((n) => Number(n.trim()));
    if (!start) continue;
    for (let page = start; page <= Math.min(end || start, total); page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

async function loadChunks(file: string, pageRange?: string): Promise<{ chunks: TextChunk[]; charsPerPage?: number }> {
  const label = path.basename(file, path.extname(file));
  if (path.extname(file).toLowerCase() !== ".pdf") {
    return { chunks: chunkText(await readFile(file, "utf8"), label) };
  }
  const data = new Uint8Array(await readFile(file));
  const inspections = await inspectPdf(data);
  const pageNumbers = parsePageRange(pageRange, inspections.length);
  console.log(`Extracting ${pageNumbers.length} of ${inspections.length} pages from ${path.basename(file)}…`);
  const pages = await extractLocalPages(data, inspections, pageNumbers, { includeImages: false });
  const entries = pages
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => ({ pageNumber: page.pageNumber, text: page.markdown }));
  const totalChars = entries.reduce((sum, page) => sum + page.text.length, 0);
  return {
    chunks: chunkPdfPageEntries(entries, label),
    charsPerPage: entries.length ? totalChars / entries.length : undefined,
  };
}

function renderCard(card: GeneratedCard, chunk: TextChunk): string {
  const found = quoteFound(card, chunk);
  const quote = card.sourceQuote
    ? `<div class="quote ${found ? "ok" : "miss"}" title="${found ? "Quote found in source" : "Quote not found verbatim in source"}">${found ? "✓" : "✗"} ${escapeHtml(card.sourceQuote)}</div>`
    : `<div class="quote none">No source quote</div>`;
  const tags = card.tags?.length ? `<div class="tags">${card.tags.map(escapeHtml).join(" · ")}</div>` : "";
  if (card.type === "cloze") {
    const text = escapeHtml(card.clozeText ?? "").replace(
      /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g,
      (_, n, answer, hint) => `<mark title="c${n}${hint ? ` · hint: ${hint}` : ""}">${answer}</mark>${hint ? `<sup>${hint}</sup>` : ""}`,
    );
    return `<div class="card"><div class="kind">Cloze</div><div class="front">${text}</div>${card.extra ? `<div class="back">${escapeHtml(card.extra)}</div>` : ""}${quote}${tags}</div>`;
  }
  return `<div class="card"><div class="kind">Basic</div><div class="front">${escapeHtml(card.front ?? "")}</div><div class="back">${escapeHtml(card.back ?? "")}</div>${quote}${tags}</div>`;
}

function money(value: number | undefined): string {
  if (value === undefined) return "—";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

interface ModelSummary {
  id: string;
  label: string;
  cards: number;
  cardsPerChunk: number;
  rejected: number;
  errors: number;
  firstError?: string;
  quotesChecked: number;
  quotesFound: number;
  medianLatencyMs: number;
  usage: Usage;
  cost?: number;
  costPer100Cards?: number;
  costPerBook?: number;
}

function summarize(
  spec: ModelSpec,
  label: string,
  results: ChunkResult[],
  chunks: TextChunk[],
  bookChars: number | undefined,
): ModelSummary {
  const usage = emptyUsage();
  let cards = 0;
  let rejected = 0;
  let errors = 0;
  let quotesChecked = 0;
  let quotesFound = 0;
  let firstError: string | undefined;
  const latencies: number[] = [];
  results.forEach((result, index) => {
    addUsage(usage, result.usage);
    cards += result.cards.length;
    rejected += result.rejected;
    errors += result.errors.length;
    firstError ??= result.errors[0];
    latencies.push(...result.latencyMs);
    for (const card of result.cards) {
      const found = quoteFound(card, chunks[index]!);
      if (found === undefined) continue;
      quotesChecked += 1;
      if (found) quotesFound += 1;
    }
  });
  const cost = costOf(spec.model, usage);
  const sampleChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  return {
    id: spec.id,
    label,
    cards,
    cardsPerChunk: cards / Math.max(1, chunks.length),
    rejected,
    errors,
    firstError,
    quotesChecked,
    quotesFound,
    medianLatencyMs: median(latencies),
    usage,
    cost,
    costPer100Cards: cost !== undefined && cards > 0 ? (cost / cards) * 100 : undefined,
    costPerBook: cost !== undefined && bookChars ? (cost / sampleChars) * bookChars : undefined,
  };
}

function renderReport(input: {
  source: string;
  settings: GenerationSettings;
  chunks: TextChunk[];
  summaries: ModelSummary[];
  results: ChunkResult[][];
  blind: boolean;
  bookLabel?: string;
}): string {
  const { chunks, summaries, results } = input;
  const rows = summaries
    .map((s) => {
      const quoteRate = s.quotesChecked ? `${Math.round((s.quotesFound / s.quotesChecked) * 100)}%` : "—";
      return `<tr>
        <td><b>${escapeHtml(s.label)}</b></td>
        <td>${s.cards} <span class="dim">(${s.cardsPerChunk.toFixed(1)}/chunk)</span></td>
        <td>${s.rejected}</td>
        <td${s.errors ? ` class="bad" title="${escapeHtml(s.firstError ?? "")}"` : ""}>${s.errors}</td>
        <td>${quoteRate}</td>
        <td>${(s.medianLatencyMs / 1000).toFixed(1)}s</td>
        <td>${s.usage.input.toLocaleString()} / ${s.usage.output.toLocaleString()}<span class="dim"> (${s.usage.reasoning.toLocaleString()} thinking)</span></td>
        <td>${money(s.cost)}</td>
        <td>${money(s.costPer100Cards)}</td>
        ${input.bookLabel ? `<td>${money(s.costPerBook)}</td>` : ""}
      </tr>`;
    })
    .join("");

  const sections = chunks
    .map((chunk, chunkIndex) => {
      const columns = summaries
        .map((s, modelIndex) => {
          const result = results[modelIndex]![chunkIndex]!;
          const errors = result.errors.map((e) => `<div class="error">${escapeHtml(e)}</div>`).join("");
          const cards = result.cards.map((card) => renderCard(card, chunk)).join("");
          return `<div class="column"><h4>${escapeHtml(s.label)} <span class="dim">${result.cards.length} cards</span></h4>${errors}${cards}</div>`;
        })
        .join("");
      return `<section>
        <h3>${escapeHtml(chunk.sourceRef)} <span class="dim">${chunk.text.length.toLocaleString()} chars</span></h3>
        <details><summary>Source text</summary><pre>${escapeHtml(chunk.text)}</pre></details>
        <div class="grid" style="grid-template-columns: repeat(${summaries.length}, minmax(260px, 1fr))">${columns}</div>
      </section>`;
    })
    .join("");

  const key = input.blind
    ? `<details class="key"><summary>Reveal which model is which</summary><ul>${summaries
        .map((s) => `<li><b>${escapeHtml(s.label)}</b> = ${escapeHtml(s.id)}</li>`)
        .join("")}</ul></details>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Card generation model comparison</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --dim: #888; }
  body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta, .dim { color: var(--dim); font-weight: normal; }
  table { border-collapse: collapse; margin: 16px 0 8px; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--dim); }
  td.bad { color: #d33; cursor: help; }
  .notes { color: var(--dim); max-width: 900px; }
  section { margin-top: 32px; border-top: 2px solid var(--line); padding-top: 12px; }
  h3 { margin: 0 0 6px; font-size: 15px; }
  h4 { margin: 0 0 8px; font-size: 13px; position: sticky; top: 0; background: Canvas; padding: 4px 0; }
  pre { white-space: pre-wrap; max-height: 320px; overflow: auto; background: #8881; padding: 8px; border-radius: 6px; }
  .grid { display: grid; gap: 12px; overflow-x: auto; margin-top: 8px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  .kind { font-size: 11px; color: var(--dim); text-transform: uppercase; }
  .front { font-weight: 600; margin: 2px 0; }
  .back { margin: 2px 0 4px; }
  mark { background: #f5c54266; color: inherit; border-radius: 3px; padding: 0 2px; }
  sup { color: var(--dim); font-size: 10px; }
  .quote { font-size: 12px; color: var(--dim); border-left: 3px solid var(--line); padding-left: 6px; margin-top: 4px; }
  .quote.ok { border-color: #2a2; } .quote.miss { border-color: #d33; } .quote.none { font-style: italic; }
  .tags { font-size: 11px; color: var(--dim); margin-top: 4px; }
  .error { color: #d33; font-size: 12px; margin-bottom: 6px; }
  .key { margin: 8px 0; }
</style></head><body>
<h1>Card generation model comparison</h1>
<div class="meta">${escapeHtml(input.source)} · ${chunks.length} chunks · cards: ${escapeHtml(input.settings.cardTypes.join(" + "))} · detail: ${escapeHtml(input.settings.detailLevel)} · ${new Date().toLocaleString()}</div>
${key}
<table>
  <tr><th>Model</th><th>Cards</th><th>Rejected</th><th>Errors</th><th>Quotes found</th><th>Median call</th><th>Tokens in / out</th><th>Sample cost</th><th>Per 100 cards</th>${input.bookLabel ? `<th>${escapeHtml(input.bookLabel)}</th>` : ""}</tr>
  ${rows}
</table>
<p class="notes"><b>Rejected</b> = cards that failed DeepHaus's validation (wrong type or broken cloze). <b>Quotes found</b> = share of source quotes that appear in the chunk word for word; a miss usually means a paraphrased or invented quote. Costs use list prices with prompt caching as measured; the batch API would halve them. Judge quality by reading the cards below: the numbers can't tell you which cards are worth studying.</p>
${sections}
</body></html>`;
}

async function main() {
  // `pnpm … compare-models -- <args>` forwards the `--`, which would end option parsing.
  const argv = process.argv.slice(2);
  const { values, positionals: files } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    allowPositionals: true,
    options: {
      pages: { type: "string" },
      chunks: { type: "string", default: "8" },
      types: { type: "string", default: "basic,cloze" },
      detail: { type: "string", default: "medium" },
      "cloze-hints": { type: "boolean", default: false },
      models: { type: "string" },
      blind: { type: "boolean", default: false },
      "env-file": { type: "string", multiple: true },
      out: { type: "string" },
      label: { type: "string", default: "production" },
      "density-scale": { type: "string", default: "1" },
    },
  });
  if (files.length === 0) {
    console.error("Usage: pnpm --filter @deephaus/llm compare-models -- <file.pdf|file.txt|file.md> [--pages 20-80] [--chunks 8] [--models a,b] [--blind]");
    process.exit(1);
  }

  loadEnvFiles(values["env-file"]);
  const specs = (values.models?.split(",") ?? DEFAULT_MODELS).map((id) => parseModelSpec(id.trim())).filter((s) => s.model);
  const clients = createClients(specs);

  const variant = values.label!;
  const densityScale = Number(values["density-scale"]);
  if (!(densityScale > 0)) throw new Error("--density-scale must be a positive number.");

  const settings = parseGenerationSettings({
    cardTypes: values.types!.split(",").map((t) => t.trim()),
    detailLevel: values.detail,
    clozeHints: values["cloze-hints"],
  });

  const loaded = await Promise.all(files.map((file) => loadChunks(fromCaller(file), values.pages)));
  const perFile = Math.max(1, Math.round(Number(values.chunks) / files.length));
  const chunks = loaded
    .flatMap((doc) => pickChunks(doc.chunks, perFile))
    .map((chunk, index) => ({ ...chunk, index }));
  if (chunks.length === 0) throw new Error("No text found in the input files.");
  const charsPerPage = loaded.find((doc) => doc.charsPerPage)?.charsPerPage;
  // --density-scale multiplies the cards-per-1,000-words target without the
  // richer answers that come with a higher detail level.
  const passes = chunkGenerationPasses(chunks, settings).map((pass) => ({
    ...pass,
    cardCountScale: (pass.cardCountScale ?? 1) * densityScale,
  }));

  const totalSteps = specs.length * chunks.length;
  let done = 0;
  console.log(`Running ${specs.length} models on ${chunks.length} chunks (${passes.length} pass${passes.length === 1 ? "" : "es"} each)…`);
  const results = await Promise.all(
    specs.map((spec) =>
      runModel(spec, chunks, settings, passes, clients, () => {
        done += 1;
        process.stdout.write(`\r  ${done}/${totalSteps} chunk runs finished`);
      }),
    ),
  );
  process.stdout.write("\n");

  // Blind mode shuffles the columns and hides names until you open the key.
  const order = specs.map((_, i) => i);
  if (values.blind) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  }
  const BOOK_PAGES = 500;
  const bookChars = charsPerPage ? charsPerPage * BOOK_PAGES : undefined;
  const summaries = order.map((specIndex, position) =>
    summarize(
      specs[specIndex]!,
      values.blind ? `Model ${String.fromCharCode(65 + position)}` : specs[specIndex]!.id,
      results[specIndex]!,
      chunks,
      bookChars,
    ),
  );
  const orderedResults = order.map((i) => results[i]!);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = values.out ? fromCaller(values.out) : path.join(REPO_ROOT, "test-results", `model-compare-${stamp}`);
  await mkdir(outDir, { recursive: true });
  const html = renderReport({
    source: files.map((f) => path.basename(f)).join(", ") + (values.pages ? ` (pages ${values.pages})` : "") + ` · ${variant}${densityScale !== 1 ? ` · ${densityScale}× density` : ""}`,
    settings,
    chunks,
    summaries,
    results: orderedResults,
    blind: values.blind!,
    bookLabel: bookChars ? `Est. ${BOOK_PAGES}-page book` : undefined,
  });
  await writeFile(path.join(outDir, "report.html"), html);
  await writeFile(
    path.join(outDir, "results.json"),
    JSON.stringify({ files, pages: values.pages, variant, densityScale, settings, chunks, summaries, results: orderedResults }, null, 2),
  );

  console.table(
    summaries.map((s) => ({
      model: s.label,
      cards: s.cards,
      rejected: s.rejected,
      errors: s.errors,
      quotes: s.quotesChecked ? `${Math.round((s.quotesFound / s.quotesChecked) * 100)}%` : "—",
      "median s": (s.medianLatencyMs / 1000).toFixed(1),
      cost: money(s.cost),
      "per 100 cards": money(s.costPer100Cards),
      ...(bookChars ? { [`${BOOK_PAGES}-page book`]: money(s.costPerBook) } : {}),
    })),
  );
  for (const s of summaries) if (s.firstError) console.warn(`${s.label}: ${s.firstError}`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
