import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { QualityLevel } from "@deephaus/shared";

export type GenerationProvider = "openai" | "anthropic";

/** One model setting: which provider, which model, and how hard it reasons. */
export interface GenerationModel {
  provider: GenerationProvider;
  model: string;
  /** Reasoning effort; omitted runs the model's default. */
  effort?: string;
}

/**
 * The model behind each quality level. Users only ever see the level.
 *
 * Chosen from blind two-judge grading (Claude Opus 5.5 and GPT-6.1 Sol) of
 * 2,886 cards from two textbooks against the card-writing research, using
 * packages/llm/scripts/grade-cards.ts. Scores (0-100) and cost per 1,000 cards
 * on 2026-11-08:
 * - low: Haiku 5.5, low effort, 78.9 at $0.23. Fastest, and already above
 *   gpt-5.4-mini (77.3), the previous default.
 * - medium: GPT-6.1 Terra, medium effort, 84.4 at $1.21. The fewest broken
 *   cards of any affordable model; it writes fewer cards per passage.
 * - high: Opus 5.5, low effort, 86.3 at $4.39. Best overall, with the widest
 *   coverage of each passage's key concepts.
 * Nothing scored measurably above Opus at low effort: Opus at medium and high
 * effort scored 86.2 and 85.4, Fable 5.1 84.6 at $10.65 and GPT-6 Astra 82.9
 * at $12.73, so there is no level above high.
 */
export const GENERATION_MODELS: Record<QualityLevel, GenerationModel> = {
  low: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
  medium: { provider: "openai", model: "gpt-6.1-terra", effort: "medium" },
  high: { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
};

/** Stand-ins when the server has no Anthropic key: the best OpenAI model at each price. */
const OPENAI_STAND_INS: Record<QualityLevel, GenerationModel> = {
  low: { provider: "openai", model: "gpt-6-luna", effort: "high" },
  medium: { provider: "openai", model: "gpt-6.1-terra", effort: "medium" },
  high: { provider: "openai", model: "gpt-6.1-terra", effort: "medium" },
};

/** `openai:gpt-6-luna@medium` or `anthropic:claude-opus-5-5@low`. */
export function parseGenerationModel(raw: string | undefined): GenerationModel | undefined {
  const match = raw?.trim().match(/^(openai|anthropic):([\w.-]+)(?:@(\w+))?$/);
  if (!match) return undefined;
  return { provider: match[1] as GenerationProvider, model: match[2]!, effort: match[3] };
}

export interface GenerationKeys {
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

/**
 * The model for a level. `GENERATION_MODEL_<LEVEL>` (for example
 * `GENERATION_MODEL_HIGH=anthropic:claude-opus-5-5@medium`) overrides the
 * default, and a level that needs a missing provider key falls back to OpenAI.
 */
export function resolveGenerationModel(
  level: QualityLevel,
  keys: GenerationKeys,
  env: Record<string, string | undefined> = process.env,
): GenerationModel {
  const chosen = parseGenerationModel(env[`GENERATION_MODEL_${level.toUpperCase()}`]) ?? GENERATION_MODELS[level];
  if (chosen.provider === "anthropic" && !keys.anthropicApiKey) return OPENAI_STAND_INS[level];
  return chosen;
}

/** Claude's structured outputs take `anyOf` where OpenAI accepts `type: [..., "null"]`. */
export function toAnthropicSchema(schema: unknown): unknown {
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

/** Models that accept Anthropic's server-side refusal fallback. */
const SERVER_FALLBACK_MODEL = /^claude-(opus-5-5|sonnet-5-5|fable-5-1)$/;

export interface JsonRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Sent to OpenAI models that run without a reasoning effort. */
  temperature?: number;
}

export interface JsonResponse {
  content?: string;
  tokenUsage: number;
  error?: string;
}

/** One structured-output request to the provider behind `model`. */
export async function requestJson(
  model: GenerationModel,
  keys: GenerationKeys,
  request: JsonRequest,
): Promise<JsonResponse> {
  try {
    return model.provider === "anthropic"
      ? await requestAnthropic(model, keys.anthropicApiKey!, request)
      : await requestOpenAI(model, keys.openaiApiKey!, request);
  } catch (error) {
    return {
      tokenUsage: 0,
      error: error instanceof Error ? error.message : `${model.provider} request failed`,
    };
  }
}

async function requestOpenAI(model: GenerationModel, apiKey: string, request: JsonRequest): Promise<JsonResponse> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: model.model,
    // Reasoning runs reject `temperature`, so it only goes to plain runs.
    ...(model.effort
      ? { reasoning_effort: model.effort as OpenAI.ReasoningEffort }
      : request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
    response_format: {
      type: "json_schema",
      json_schema: { name: request.schemaName, strict: true, schema: request.schema },
    },
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  });
  return {
    content: response.choices[0]?.message?.content ?? undefined,
    tokenUsage: response.usage?.total_tokens ?? 0,
  };
}

async function requestAnthropic(model: GenerationModel, apiKey: string, request: JsonRequest): Promise<JsonResponse> {
  const client = new Anthropic({ apiKey });
  const serverFallback = SERVER_FALLBACK_MODEL.test(model.model);
  const response = await client.beta.messages
    .stream({
      model: model.model,
      max_tokens: 32000,
      // The rules prompt repeats on every chunk of a run, so cache it.
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: request.user }],
      output_config: {
        format: { type: "json_schema", schema: toAnthropicSchema(request.schema) as Record<string, unknown> },
        ...(model.effort ? { effort: model.effort as Anthropic.Beta.BetaOutputConfig["effort"] } : {}),
      },
      // A declined request reruns on the model's default fallback instead of failing the chunk.
      ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    })
    .finalMessage();
  const usage = response.usage;
  const tokenUsage =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    usage.output_tokens;
  if (response.stop_reason === "refusal") return { tokenUsage, error: "The model declined this material." };
  if (response.stop_reason === "max_tokens") return { tokenUsage, error: "The model ran out of room before finishing." };
  const content = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return { content: content || undefined, tokenUsage };
}
