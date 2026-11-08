/**
 * Shared plumbing for the model comparison scripts: model specs, prices,
 * env loading and one structured-output call per provider.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** pnpm runs scripts from the package folder; resolve paths from where the user ran it. */
const CALLER_CWD = process.env.INIT_CWD ?? process.cwd();
export const fromCaller = (file: string) => path.resolve(CALLER_CWD, file);

/** USD per 1M tokens, from the OpenAI and Anthropic pricing pages (Nov 2026). */
export const PRICES: Record<string, { input: number; cachedInput: number; cacheWrite?: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6.1-terra": { input: 1, cachedInput: 0.05, output: 5 },
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10 },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
  "claude-opus-5-5": { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
  "claude-fable-5-1": { input: 10, cachedInput: 0.25, cacheWrite: 12.5, output: 50 },
};

export interface ModelSpec {
  id: string;
  model: string;
  effort?: string;
  provider: "openai" | "anthropic";
}

export interface Usage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface CallResult {
  content?: string;
  usage: Usage;
  latencyMs: number;
  error?: string;
}

export interface Clients {
  openai?: OpenAI;
  anthropic?: Anthropic;
}

export const emptyUsage = (): Usage => ({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 });

export function addUsage(total: Usage, next: Usage) {
  total.input += next.input;
  total.cachedInput += next.cachedInput;
  total.cacheWrite += next.cacheWrite;
  total.output += next.output;
  total.reasoning += next.reasoning;
}

export function parseModelSpec(id: string): ModelSpec {
  const [model, effort] = id.split("@") as [string, string | undefined];
  return { id, model, effort, provider: model.startsWith("claude-") ? "anthropic" : "openai" };
}

/** Load KEY=VALUE lines without overriding variables already set. */
export function loadEnvFiles(files: string[] | undefined) {
  for (const file of files ?? [path.join(REPO_ROOT, "apps/web/.env.local"), path.join(REPO_ROOT, ".env.local")]) {
    const resolved = fromCaller(file);
    if (!existsSync(resolved)) continue;
    for (const line of readFileSync(resolved, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, raw] = match as unknown as [string, string, string];
      if (process.env[key]) continue;
      process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

export function createClients(specs: ModelSpec[]): Clients {
  const needsOpenAI = specs.some((s) => s.provider === "openai");
  const needsAnthropic = specs.some((s) => s.provider === "anthropic");
  if (needsOpenAI && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set. Pass --env-file with a file that has it.");
  if (needsAnthropic && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Pass --env-file with a file that has it.");
  return {
    openai: needsOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : undefined,
    anthropic: needsAnthropic ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined,
  };
}

export function costOf(model: string, usage: Usage): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;
  const uncached = Math.max(0, usage.input - usage.cachedInput - usage.cacheWrite);
  return (
    (uncached * price.input +
      usage.cachedInput * price.cachedInput +
      usage.cacheWrite * (price.cacheWrite ?? price.input) +
      usage.output * price.output) /
    1_000_000
  );
}

/** Claude's structured outputs want `anyOf` where OpenAI accepts `type: [..., "null"]`. */
function toAnthropicSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toAnthropicSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = toAnthropicSchema(value);
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    delete out.type;
    return { ...out, anyOf: types.map((type) => ({ type })) };
  }
  return out;
}

export interface JsonCall {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Sent only when the spec has no reasoning effort (reasoning runs reject it). */
  temperature?: number;
}

/** One structured-output request to whichever provider serves the spec. */
export async function callJson(clients: Clients, spec: ModelSpec, call: JsonCall): Promise<CallResult> {
  return spec.provider === "anthropic"
    ? callAnthropic(clients.anthropic!, spec, call)
    : callOpenAI(clients.openai!, spec, call);
}

async function callOpenAI(client: OpenAI, spec: ModelSpec, call: JsonCall): Promise<CallResult> {
  const started = Date.now();
  try {
    const response = await client.chat.completions.create({
      model: spec.model,
      ...(spec.effort
        ? { reasoning_effort: spec.effort as OpenAI.ReasoningEffort }
        : call.temperature !== undefined
          ? { temperature: call.temperature }
          : {}),
      response_format: {
        type: "json_schema",
        json_schema: { name: call.schemaName, strict: true, schema: call.schema },
      },
      messages: [
        { role: "system", content: call.system },
        { role: "user", content: call.user },
      ],
    });
    const usage = response.usage;
    return {
      content: response.choices[0]?.message?.content ?? undefined,
      latencyMs: Date.now() - started,
      usage: {
        input: usage?.prompt_tokens ?? 0,
        cachedInput: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWrite: 0,
        output: usage?.completion_tokens ?? 0,
        reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  } catch (error) {
    return { latencyMs: Date.now() - started, usage: emptyUsage(), error: errorMessage(error) };
  }
}

async function callAnthropic(client: Anthropic, spec: ModelSpec, call: JsonCall): Promise<CallResult> {
  const started = Date.now();
  try {
    const stream = client.messages.stream({
      model: spec.model,
      max_tokens: 32000,
      // The system prompt repeats across requests, so cache it like production would.
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.user }],
      output_config: {
        format: { type: "json_schema", schema: toAnthropicSchema(call.schema) as Record<string, unknown> },
        ...(spec.effort ? { effort: spec.effort as Anthropic.OutputConfig["effort"] } : {}),
      },
    });
    const response = await stream.finalMessage();
    const usage = response.usage;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const result: CallResult = {
      latencyMs: Date.now() - started,
      usage: {
        input: usage.input_tokens + cacheRead + cacheWrite,
        cachedInput: cacheRead,
        cacheWrite,
        output: usage.output_tokens,
        reasoning: usage.output_tokens_details?.thinking_tokens ?? 0,
      },
    };
    if (response.stop_reason === "refusal") return { ...result, error: "Model refused the request." };
    if (response.stop_reason === "max_tokens") return { ...result, error: "Hit max_tokens before finishing." };
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return { ...result, content: text };
  } catch (error) {
    return { latencyMs: Date.now() - started, usage: emptyUsage(), error: errorMessage(error) };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run `task` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
