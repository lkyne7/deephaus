/**
 * Grade generated flashcards against published card-writing research.
 *
 * Reads results.json files written by compare-models and has judges from
 * different providers grade every model's cards blind, one source chunk at a
 * time. Each judge first lists the passage's key concepts, then grades each
 * card on the Memory Machines tiers (Kirkby & Matuschak, 2026) with issue
 * tags drawn from SuperMemo's 20 rules, Matuschak's prompt guide and
 * Nielsen's Anki essay. Cloze counts and answer lengths are measured in code.
 *
 *   pnpm --filter @deephaus/llm grade-cards -- <results.json> [...]
 *     [--judges claude-opus-5-5@medium,gpt-6.1-sol@medium] [--limit-sets 4]
 *     [--env-file ...] [--out ../../test-results/grading/report]
 *
 * Judge answers are cached under <out>/cache, so a rerun only pays for new work.
 */
import { createHash, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { escapeHtml, type GeneratedCard, type TextChunk } from "@deephaus/shared";
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

const DEFAULT_JUDGES = ["claude-opus-5-5@medium", "gpt-6.1-sol@medium"];
const JUDGE_CONCURRENCY = 6;
const BOOK_PAGES = 500;

/** Memory Machines review-cost weights: a broken card costs more than a good card earns. */
const TIER_UTILITY = { T3: 2, T2: 1.5, T1: -3, T0: -1 } as const;
type Tier = keyof typeof TIER_UTILITY;

const ISSUES = [
  "multiple_facts",
  "answer_is_list",
  "multiple_valid_answers",
  "ambiguous_or_lacks_context",
  "yes_no_or_guessable",
  "answer_given_away",
  "cloze_hides_filler",
  "too_many_clozes",
  "wordy",
  "long_answer",
  "copied_long_sentence",
  "trivia",
  "inaccurate_or_unsupported",
  "duplicate",
] as const;

// ---------------------------------------------------------------- inputs

interface CompareResults {
  files: string[];
  /** Run label from compare-models (`promptStyle` in older runs). */
  variant?: string;
  promptStyle?: string;
  chunks: TextChunk[];
  summaries: Array<{ id: string; costPerBook?: number; cost?: number; cards: number }>;
  results: Array<Array<{ cards: GeneratedCard[] }>>;
}

interface CardSet {
  key: string;
  book: string;
  prompt: string;
  model: string;
  chunk: TextChunk;
  cards: GeneratedCard[];
}

interface ModelRun {
  book: string;
  prompt: string;
  model: string;
  costPerBook?: number;
}

async function loadSets(files: string[]): Promise<{ sets: CardSet[]; runs: ModelRun[] }> {
  const sets: CardSet[] = [];
  const runs: ModelRun[] = [];
  for (const file of files) {
    const data = JSON.parse(await readFile(fromCaller(file), "utf8")) as CompareResults;
    const book = path.basename(data.files[0] ?? file, path.extname(data.files[0] ?? file));
    const prompt = data.variant ?? data.promptStyle ?? "current";
    data.summaries.forEach((summary, modelIndex) => {
      runs.push({ book, prompt, model: summary.id, costPerBook: summary.costPerBook });
      data.chunks.forEach((chunk, chunkIndex) => {
        sets.push({
          key: `${book}|${prompt}|${summary.id}|${chunk.sourceRef}`,
          book,
          prompt,
          model: summary.id,
          chunk,
          cards: data.results[modelIndex]![chunkIndex]!.cards,
        });
      });
    });
  }
  return { sets, runs };
}

// ---------------------------------------------------------------- deterministic checks

function clozeDeletions(card: GeneratedCard): number {
  return [...(card.clozeText ?? "").matchAll(/\{\{c\d+::/g)].length;
}

function words(text: string | null | undefined): number {
  return (text ?? "").replace(/\{\{c\d+::|\}\}|::[^}]*/g, " ").split(/\s+/).filter(Boolean).length;
}

/** 1–2 deletions follow the research; 3 is the ceiling; more breaks atomicity. */
function clozeFormatScore(card: GeneratedCard): number {
  const n = clozeDeletions(card);
  return n <= 2 ? 1 : n === 3 ? 0.6 : 0;
}

// ---------------------------------------------------------------- judge prompts

const CONCEPTS_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          concept: { type: "string" },
          importance: { type: "string", enum: ["core", "supporting"] },
        },
        required: ["id", "concept", "importance"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts"],
  additionalProperties: false,
};

const CONCEPTS_SYSTEM = `You are an experienced university teacher and spaced-repetition practitioner. You decide what in a passage is worth a student's long-term memory.`;

function conceptsUser(chunk: TextChunk): string {
  return `List the distinct ideas in this textbook passage that a diligent student should still be able to recall months from now.

- Mark each as "core" (central to understanding this passage) or "supporting" (a useful detail, example or number).
- One idea per entry, stated in a short sentence. Use ids K1, K2, ...
- Leave out citations, researcher names, dates, figure or page references, and publisher text unless the passage is about them.
- If the passage is a reference list, index, table of contents or exercises with no new content, return an empty list.
- Most passages have 4 to 12 ideas.

Passage:
"""
${chunk.text}
"""`;
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          tier: { type: "string", enum: ["T3", "T2", "T1", "T0"] },
          concepts: { type: "array", items: { type: "string" } },
          issues: { type: "array", items: { type: "string", enum: [...ISSUES] } },
          note: { type: "string" },
        },
        required: ["n", "tier", "concepts", "issues", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
};

const GRADE_SYSTEM = `You grade flashcards for a spaced-repetition app. A learner will review each card for months without the source in front of them, so a card is only good if it keeps cueing the same correct answer long after they read the passage.

The standard comes from the card-writing literature:
- Minimum information principle (Wozniak, SuperMemo's 20 rules): each card tests one simple idea. Complex items are forgotten faster and interfere with each other.
- Matuschak's prompt properties: focused (one detail), precise (a vague question gets a vague answer), consistent (the same answer every time), tractable (answerable), effortful (the answer cannot be inferred trivially from the cue).
- Nielsen: atomic questions and answers; yes/no questions are a smell.
- Avoid sets and enumerations: a card that asks for a whole list is hard to recall reliably.
- Optimise wording: remove words that do not help recall. Long copied sentences invite pattern matching instead of recall.
- Cloze deletions should hide the key term, not filler. In Anki each c-number becomes its own review; deletions sharing a number are hidden together. One deletion per note is ideal, two is fine when the items belong together, three is the ceiling, and more breaks atomicity.

Tiers (Kirkby & Matuschak, Memory Machines, 2026):
- T3 Ready to review: worth remembering, atomic, precise, concise. Would reliably cue the same correct answer months from now.
- T2 Needs polish: well targeted and would work, but has friction: wordy, a longer answer than needed, or a cloze sentence longer than it should be.
- T1 Needs refactor: looks plausible but breaks in review. Use T1 when the card tests several facts at once, asks for a list, has more than one defensible answer, is ambiguous or depends on missing context (an unclear subject, "the study", "this"), is a yes/no or trivially guessable question, gives its own answer away, hides filler words in a cloze, has more than three cloze deletions, or states something inaccurate or not supported by the passage.
- T0 Off-target: not worth remembering (trivia, citations, page furniture), or a duplicate of an earlier card in this set that asks for the same answer from the same cue. Asking about the same concept from a genuinely different angle is not a duplicate.

Judge each card on its own merits. Do not reward or punish a set for its size. Be strict about T1: plausible-looking cards that break in review are the costliest failure. Keep each note under 20 words and say what is wrong; leave it empty for T3.`;

function formatCard(card: GeneratedCard, n: number): string {
  if (card.type === "cloze") {
    const ids = [...new Set([...(card.clozeText ?? "").matchAll(/\{\{c(\d+)::/g)].map((m) => `c${m[1]}`))];
    return `Card ${n} [cloze; ${clozeDeletions(card)} deletion(s); review cards: ${ids.join(", ")}]
Text: ${card.clozeText}${card.extra ? `\nExtra (shown after answering): ${card.extra}` : ""}`;
  }
  return `Card ${n} [basic]
Q: ${card.front}
A: ${card.back}`;
}

function gradeUser(set: CardSet, concepts: Concept[]): string {
  const conceptList = concepts.length
    ? concepts.map((c) => `${c.id} (${c.importance}): ${c.concept}`).join("\n")
    : "(none: the passage has nothing worth remembering)";
  return `Passage:
"""
${set.chunk.text}
"""

Key concepts in this passage:
${conceptList}

Grade every card below. For each, give the tier, the ids of the concepts it tests (empty if none), any issue tags that apply, and a short note.

${set.cards.map((card, i) => formatCard(card, i + 1)).join("\n\n")}`;
}

// ---------------------------------------------------------------- judging

interface Concept {
  id: string;
  concept: string;
  importance: "core" | "supporting";
}

interface CardGrade {
  n: number;
  tier: Tier;
  concepts: string[];
  issues: string[];
  note: string;
}

interface SetGrade {
  judge: string;
  key: string;
  concepts: Concept[];
  cards: CardGrade[];
  error?: string;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

async function cached<T>(dir: string, key: string, compute: () => Promise<T | undefined>): Promise<T | undefined> {
  const file = path.join(dir, `${sha(key)}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")) as T;
  const value = await compute();
  if (value !== undefined) await writeFile(file, JSON.stringify(value));
  return value;
}

async function runJudge(
  judge: ModelSpec,
  sets: CardSet[],
  clients: Clients,
  cacheDir: string,
  usage: Usage,
  progress: () => void,
): Promise<SetGrade[]> {
  const conceptsByChunk = new Map<string, Promise<Concept[]>>();
  const conceptsFor = (chunk: TextChunk) => {
    const key = `concepts|${judge.id}|${chunk.text}`;
    if (!conceptsByChunk.has(key)) {
      conceptsByChunk.set(
        key,
        cached<Concept[]>(cacheDir, key, async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const call = await callJson(clients, judge, {
              system: CONCEPTS_SYSTEM,
              user: conceptsUser(chunk),
              schemaName: "concepts",
              schema: CONCEPTS_SCHEMA,
            });
            addUsage(usage, call.usage);
            if (call.content) return (JSON.parse(call.content) as { concepts: Concept[] }).concepts;
            console.warn(`\n${judge.id} concepts failed: ${call.error}`);
          }
          return undefined;
        }).then((value) => value ?? []),
      );
    }
    return conceptsByChunk.get(key)!;
  };

  return mapLimit(sets, JUDGE_CONCURRENCY, async (set) => {
    const concepts = await conceptsFor(set.chunk);
    if (set.cards.length === 0) {
      progress();
      return { judge: judge.id, key: set.key, concepts, cards: [] };
    }
    const cardsKey = `grade|${judge.id}|${set.chunk.text}|${JSON.stringify(set.cards.map((c) => [c.front, c.back, c.clozeText, c.extra]))}`;
    const grades = await cached<CardGrade[]>(cacheDir, cardsKey, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const call = await callJson(clients, judge, {
          system: GRADE_SYSTEM,
          user: gradeUser(set, concepts),
          schemaName: "card_grades",
          schema: GRADE_SCHEMA,
        });
        addUsage(usage, call.usage);
        if (call.content) {
          const parsed = (JSON.parse(call.content) as { cards: CardGrade[] }).cards;
          if (parsed.length === set.cards.length) return parsed;
          console.warn(`\n${judge.id} graded ${parsed.length}/${set.cards.length} cards for ${set.key}; retrying`);
        } else {
          console.warn(`\n${judge.id} grade failed for ${set.key}: ${call.error}`);
        }
      }
      return undefined;
    });
    progress();
    return grades
      ? { judge: judge.id, key: set.key, concepts, cards: grades }
      : { judge: judge.id, key: set.key, concepts, cards: [], error: "Judge failed after 3 attempts." };
  });
}

// ---------------------------------------------------------------- scoring

interface SetStats {
  set: CardSet;
  judge: string;
  utilities: number[];
  tiers: Tier[];
  atomic: boolean[];
  clozeScores: number[];
  coreTotal: number;
  coreCovered: number;
}

function setStats(set: CardSet, grade: SetGrade): SetStats {
  const usableConcepts = new Set<string>();
  const tiers: Tier[] = [];
  const atomic: boolean[] = [];
  grade.cards.forEach((card) => {
    tiers.push(card.tier);
    atomic.push(!card.issues.includes("multiple_facts") && !card.issues.includes("answer_is_list") && !card.issues.includes("too_many_clozes"));
    if (card.tier === "T3" || card.tier === "T2") card.concepts.forEach((id) => usableConcepts.add(id));
  });
  const core = grade.concepts.filter((c) => c.importance === "core");
  return {
    set,
    judge: grade.judge,
    utilities: tiers.map((tier) => TIER_UTILITY[tier]),
    tiers,
    atomic,
    clozeScores: set.cards.filter((c) => c.type === "cloze").map(clozeFormatScore),
    coreTotal: core.length,
    coreCovered: core.filter((c) => usableConcepts.has(c.id)).length,
  };
}

interface Score {
  composite: number;
  quality: number;
  coverage: number;
  clozeFormat: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * Composite = 50% card quality + 30% core-concept coverage + 20% cloze format.
 * Quality maps each card's tier utility from [-3, 2] onto [0, 100], so T3 = 100,
 * T2 = 90, T0 = 40 and T1 = 0.
 */
function score(stats: SetStats[]): Score {
  const utilities = stats.flatMap((s) => s.utilities);
  const quality = utilities.length ? ((mean(utilities) + 3) / 5) * 100 : 0;
  const withCore = stats.filter((s) => s.coreTotal > 0);
  const coverage = withCore.length ? mean(withCore.map((s) => s.coreCovered / s.coreTotal)) * 100 : 0;
  const cloze = stats.flatMap((s) => s.clozeScores);
  const clozeFormat = cloze.length ? mean(cloze) * 100 : 100;
  return { composite: 0.5 * quality + 0.3 * coverage + 0.2 * clozeFormat, quality, coverage, clozeFormat };
}

/** 95% interval from resampling source chunks, so small samples show their uncertainty. */
function bootstrap(stats: SetStats[], rounds = 1000): [number, number] {
  const byChunk = new Map<string, SetStats[]>();
  for (const s of stats) {
    const key = `${s.set.book}|${s.set.chunk.sourceRef}`;
    byChunk.set(key, [...(byChunk.get(key) ?? []), s]);
  }
  const groups = [...byChunk.values()];
  const samples: number[] = [];
  for (let r = 0; r < rounds; r += 1) {
    const picked = Array.from({ length: groups.length }, () => groups[randomInt(groups.length)]!).flat();
    samples.push(score(picked).composite);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(rounds * 0.025)]!, samples[Math.floor(rounds * 0.975)]!];
}

function letter(composite: number): string {
  return composite >= 85 ? "A" : composite >= 75 ? "B" : composite >= 65 ? "C" : composite >= 55 ? "D" : "F";
}

interface Row {
  prompt: string;
  model: string;
  score: Score;
  ci: [number, number];
  byJudge: Record<string, number>;
  byBook: Record<string, number>;
  cards: number;
  cardsPerChunk: number;
  tierShare: Record<Tier, number>;
  atomicShare: number;
  cloze: { cards: number; upTo2: number; upTo3: number };
  medianAnswerWords: number;
  costPerBook?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function buildRows(all: SetStats[], runs: ModelRun[], judges: string[]): Row[] {
  const groups = new Map<string, SetStats[]>();
  for (const s of all) {
    const key = `${s.set.prompt}|${s.set.model}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()].map(([key, stats]) => {
    const [prompt, model] = key.split("|") as [string, string];
    const tiers = stats.flatMap((s) => s.tiers);
    const uniqueSets = [...new Map(stats.map((s) => [s.set.key, s.set])).values()];
    const cards = uniqueSets.flatMap((s) => s.cards);
    const clozeCards = cards.filter((c) => c.type === "cloze");
    const books = [...new Set(uniqueSets.map((s) => s.book))];
    const costs = runs.filter((r) => r.prompt === prompt && r.model === model && r.costPerBook !== undefined).map((r) => r.costPerBook!);
    return {
      prompt,
      model,
      score: score(stats),
      ci: bootstrap(stats),
      byJudge: Object.fromEntries(judges.map((j) => [j, score(stats.filter((s) => s.judge === j)).composite])),
      byBook: Object.fromEntries(books.map((b) => [b, score(stats.filter((s) => s.set.book === b)).composite])),
      cards: cards.length,
      cardsPerChunk: cards.length / Math.max(1, uniqueSets.length),
      tierShare: Object.fromEntries(
        (["T3", "T2", "T1", "T0"] as Tier[]).map((t) => [t, tiers.filter((x) => x === t).length / Math.max(1, tiers.length)]),
      ) as Record<Tier, number>,
      atomicShare: mean(stats.flatMap((s) => s.atomic.map(Number))),
      cloze: {
        cards: clozeCards.length,
        upTo2: clozeCards.filter((c) => clozeDeletions(c) <= 2).length / Math.max(1, clozeCards.length),
        upTo3: clozeCards.filter((c) => clozeDeletions(c) <= 3).length / Math.max(1, clozeCards.length),
      },
      medianAnswerWords: median(cards.filter((c) => c.type === "basic").map((c) => words(c.back))),
      costPerBook: costs.length ? mean(costs) : undefined,
    };
  });
}

// ---------------------------------------------------------------- agreement

function agreement(grades: SetGrade[], judges: string[]) {
  if (judges.length < 2) return undefined;
  const [a, b] = judges as [string, string];
  const byKey = new Map<string, Record<string, SetGrade>>();
  for (const g of grades) byKey.set(g.key, { ...(byKey.get(g.key) ?? {}), [g.judge]: g });
  let pairs = 0;
  let exact = 0;
  let usableAgree = 0;
  let aUsable = 0;
  let bUsable = 0;
  for (const entry of byKey.values()) {
    const ga = entry[a];
    const gb = entry[b];
    if (!ga || !gb || ga.cards.length !== gb.cards.length) continue;
    ga.cards.forEach((card, i) => {
      const other = gb.cards[i]!;
      const ua = card.tier === "T3" || card.tier === "T2";
      const ub = other.tier === "T3" || other.tier === "T2";
      pairs += 1;
      if (card.tier === other.tier) exact += 1;
      if (ua === ub) usableAgree += 1;
      if (ua) aUsable += 1;
      if (ub) bUsable += 1;
    });
  }
  const po = usableAgree / Math.max(1, pairs);
  const pa = aUsable / Math.max(1, pairs);
  const pb = bUsable / Math.max(1, pairs);
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return { pairs, exact: exact / Math.max(1, pairs), usable: po, kappa: (po - pe) / (1 - pe || 1) };
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (vs: number[]) => {
    const order = vs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(vs.length);
    order.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const d2 = rx.reduce((sum, r, i) => sum + (r - ry[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

// ---------------------------------------------------------------- report

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fixed = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const money = (x?: number) => (x === undefined ? "—" : x < 0.1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);

function renderReport(input: {
  rows: Row[];
  judges: string[];
  books: string[];
  agree?: ReturnType<typeof agreement>;
  rankAgreement: Record<string, number>;
  selfPreference: Array<{ judge: string; gap: number }>;
  examples: Array<{ model: string; prompt: string; card: GeneratedCard; tier: Tier; notes: string[] }>;
  judgeCost: number;
}): string {
  const prompts = [...new Set(input.rows.map((r) => r.prompt))].sort();
  const tables = prompts
    .map((prompt) => {
      const rows = input.rows.filter((r) => r.prompt === prompt).sort((a, b) => b.score.composite - a.score.composite);
      return `<h2>${escapeHtml(prompt)}</h2>
<table><tr><th>Model</th><th>Grade</th><th>Score (95% CI)</th><th>Quality</th><th>Core coverage</th><th>Cloze format</th><th>T3 / T2 / T1 / T0</th><th>Atomic</th><th>Cloze ≤2 / ≤3</th><th>Cards / chunk</th><th>Answer words</th>${input.judges.map((j) => `<th>${escapeHtml(j)}</th>`).join("")}${input.books.map((b) => `<th>${escapeHtml(b)}</th>`).join("")}<th>Cost / ${BOOK_PAGES}-page book</th></tr>
${rows
  .map(
    (r) => `<tr><td><b>${escapeHtml(r.model)}</b></td><td class="grade g${letter(r.score.composite)}">${letter(r.score.composite)}</td>
<td>${fixed(r.score.composite)} <span class="dim">(${fixed(r.ci[0])}–${fixed(r.ci[1])})</span></td>
<td>${fixed(r.score.quality)}</td><td>${fixed(r.score.coverage)}</td><td>${fixed(r.score.clozeFormat)}</td>
<td>${pct(r.tierShare.T3)} / ${pct(r.tierShare.T2)} / <b>${pct(r.tierShare.T1)}</b> / ${pct(r.tierShare.T0)}</td>
<td>${pct(r.atomicShare)}</td><td>${pct(r.cloze.upTo2)} / ${pct(r.cloze.upTo3)}</td><td>${fixed(r.cardsPerChunk)}</td><td>${r.medianAnswerWords}</td>
${input.judges.map((j) => `<td>${fixed(r.byJudge[j] ?? NaN)}</td>`).join("")}${input.books.map((b) => `<td>${fixed(r.byBook[b] ?? NaN)}</td>`).join("")}
<td>${money(r.costPerBook)}</td></tr>`,
  )
  .join("")}
</table>`;
    })
    .join("");

  const agree = input.agree
    ? `<p>Card-level agreement between judges over ${input.agree.pairs} cards: same tier ${pct(input.agree.exact)}, same usable/unusable call ${pct(input.agree.usable)} (Cohen's κ ${input.agree.kappa.toFixed(2)}). Memory Machines reported κ 0.61 between its best judge and humans.</p>`
    : "";
  const ranks = Object.entries(input.rankAgreement)
    .map(([prompt, rho]) => `<li>${escapeHtml(prompt)}: Spearman ρ ${rho.toFixed(2)} between the judges' model rankings</li>`)
    .join("");
  const bias = input.selfPreference
    .map((s) => `<li>${escapeHtml(s.judge)} scored Claude models ${s.gap >= 0 ? "+" : ""}${s.gap.toFixed(1)} points vs OpenAI models</li>`)
    .join("");

  const examples = input.examples
    .map(
      (e) => `<div class="card"><div class="dim">${escapeHtml(e.model)} · ${escapeHtml(e.prompt)} · ${e.tier}</div>
${e.card.type === "cloze" ? `<div><b>${escapeHtml(e.card.clozeText ?? "")}</b></div>` : `<div><b>Q:</b> ${escapeHtml(e.card.front ?? "")}</div><div><b>A:</b> ${escapeHtml(e.card.back ?? "")}</div>`}
${e.notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join("")}</div>`,
    )
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Flashcard model grades</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --dim: #888; }
  body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; max-width: 1500px; }
  table { border-collapse: collapse; margin: 8px 0 24px; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; color: var(--dim); }
  .dim { color: var(--dim); }
  .grade { font-weight: 700; text-align: center; }
  .gA { color: #1a7f37; } .gB { color: #4c9a2a; } .gC { color: #b08800; } .gD { color: #d4700a; } .gF { color: #cf222e; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 0 0 8px; max-width: 900px; }
  .note { font-size: 12px; color: var(--dim); }
</style></head><body>
<h1>Flashcard model grades</h1>
<p class="dim">Judges: ${input.judges.map(escapeHtml).join(", ")} · books: ${input.books.map(escapeHtml).join(", ")} · judge spend ${money(input.judgeCost)}</p>
<p>Score = 50% card quality + 30% core-concept coverage + 20% cloze format. Quality maps each card's Memory Machines tier to T3 = 100, T2 = 90, T0 = 40, T1 = 0, using its review-cost weights. Coverage is the share of each passage's core concepts tested by at least one usable (T2/T3) card. Cloze format scores 1–2 deletions as 1, 3 as 0.6 and 4+ as 0. Grades: A ≥ 85, B ≥ 75, C ≥ 65, D ≥ 55.</p>
${tables}
<h2>Judge reliability</h2>${agree}<ul>${ranks}${bias}</ul>
<h2>Cards both judges marked broken (T1)</h2>${examples || "<p>None.</p>"}
</body></html>`;
}

// ---------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const { values, positionals: files } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    allowPositionals: true,
    options: {
      judges: { type: "string" },
      "limit-sets": { type: "string" },
      "env-file": { type: "string", multiple: true },
      out: { type: "string" },
    },
  });
  if (files.length === 0) {
    console.error("Usage: pnpm --filter @deephaus/llm grade-cards -- <results.json> [...] [--judges a,b] [--limit-sets N]");
    process.exit(1);
  }
  loadEnvFiles(values["env-file"]);
  const judges = (values.judges?.split(",") ?? DEFAULT_JUDGES).map((id) => parseModelSpec(id.trim()));
  const clients = createClients(judges);

  const { sets: allSets, runs } = await loadSets(files);
  const limit = values["limit-sets"] ? Number(values["limit-sets"]) : undefined;
  const sets = limit ? allSets.slice(0, limit) : allSets;
  const outDir = values.out ? fromCaller(values.out) : path.join(REPO_ROOT, "test-results", "grading", "report");
  const cacheDir = path.join(outDir, "cache");
  await mkdir(cacheDir, { recursive: true });

  const total = sets.length * judges.length;
  let done = 0;
  console.log(`Grading ${sets.length} card sets (${sets.reduce((n, s) => n + s.cards.length, 0)} cards) with ${judges.length} judges…`);
  const usageByJudge = judges.map(() => emptyUsage());
  const grades = (
    await Promise.all(
      judges.map((judge, j) =>
        runJudge(judge, sets, clients, cacheDir, usageByJudge[j]!, () => {
          done += 1;
          process.stdout.write(`\r  ${done}/${total} graded`);
        }),
      ),
    )
  ).flat();
  process.stdout.write("\n");
  const judgeCost = judges.reduce((sum, judge, j) => sum + (costOf(judge.model, usageByJudge[j]!) ?? 0), 0);

  const setByKey = new Map(sets.map((s) => [s.key, s]));
  const failed = grades.filter((g) => g.error);
  if (failed.length) console.warn(`${failed.length} set gradings failed and are left out.`);
  const stats = grades.filter((g) => !g.error).map((g) => setStats(setByKey.get(g.key)!, g));
  const judgeIds = judges.map((j) => j.id);
  const rows = buildRows(stats, runs, judgeIds);
  const books = [...new Set(sets.map((s) => s.book))];

  const rankAgreement: Record<string, number> = {};
  if (judgeIds.length >= 2) {
    for (const prompt of new Set(rows.map((r) => r.prompt))) {
      const promptRows = rows.filter((r) => r.prompt === prompt);
      rankAgreement[prompt] = spearman(
        promptRows.map((r) => r.byJudge[judgeIds[0]!] ?? 0),
        promptRows.map((r) => r.byJudge[judgeIds[1]!] ?? 0),
      );
    }
  }
  const selfPreference = judgeIds.map((judge) => {
    const claude = rows.filter((r) => r.model.startsWith("claude-")).map((r) => r.byJudge[judge] ?? NaN);
    const openai = rows.filter((r) => !r.model.startsWith("claude-")).map((r) => r.byJudge[judge] ?? NaN);
    return { judge, gap: mean(claude) - mean(openai) };
  });

  // Cards every judge called broken, a few per model, for reading.
  const examples: Array<{ model: string; prompt: string; card: GeneratedCard; tier: Tier; notes: string[] }> = [];
  const gradesByKey = new Map<string, SetGrade[]>();
  for (const g of grades) gradesByKey.set(g.key, [...(gradesByKey.get(g.key) ?? []), g]);
  for (const row of rows) {
    const picked: typeof examples = [];
    for (const set of sets.filter((s) => s.model === row.model && s.prompt === row.prompt)) {
      const setGrades = gradesByKey.get(set.key) ?? [];
      set.cards.forEach((card, i) => {
        const cardGrades = setGrades.map((g) => g.cards[i]).filter((c): c is CardGrade => Boolean(c));
        if (cardGrades.length === judges.length && cardGrades.every((c) => c.tier === "T1")) {
          picked.push({ model: row.model, prompt: row.prompt, card, tier: "T1", notes: cardGrades.map((c, k) => `${judgeIds[k]}: ${c.note}`) });
        }
      });
    }
    examples.push(...picked.slice(0, 3));
  }

  const report = renderReport({ rows, judges: judgeIds, books, agree: agreement(grades, judgeIds), rankAgreement, selfPreference, examples, judgeCost });
  await writeFile(path.join(outDir, "grades.html"), report);
  await writeFile(path.join(outDir, "grades.json"), JSON.stringify({ judges: judgeIds, rows, grades, rankAgreement, selfPreference, judgeCost }, null, 2));

  for (const prompt of [...new Set(rows.map((r) => r.prompt))].sort()) {
    console.log(`\n${prompt}`);
    console.table(
      rows
        .filter((r) => r.prompt === prompt)
        .sort((a, b) => b.score.composite - a.score.composite)
        .map((r) => ({
          model: r.model,
          grade: letter(r.score.composite),
          score: `${fixed(r.score.composite)} (${fixed(r.ci[0])}-${fixed(r.ci[1])})`,
          quality: fixed(r.score.quality),
          coverage: fixed(r.score.coverage),
          cloze: fixed(r.score.clozeFormat),
          T1: pct(r.tierShare.T1),
          usable: pct(r.tierShare.T3 + r.tierShare.T2),
          ...Object.fromEntries(judgeIds.map((j) => [j.split("@")[0]!, fixed(r.byJudge[j] ?? NaN)])),
          "book $": money(r.costPerBook),
        })),
    );
  }
  console.log(`Judge spend: ${money(judgeCost)} (this run, excluding cached answers)`);
  console.log(`Report: ${path.join(outDir, "grades.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
