import { modelLabel, resolveTutorModel } from "./card-tutor.js";
import type { LlmConfig } from "./generate.js";
import { requestJson, type GenerationModel, type JsonRequest } from "./generation-models.js";

/**
 * The model behind the small card helpers (mnemonic, regenerate, assistant
 * edits) and the Assistant menu: the same one as the Explain tutor, Haiku 5.5
 * by default with an OpenAI stand-in when the server has no Anthropic key
 * (`TUTOR_MODEL` overrides both). An explicit `config.model` still forces that
 * OpenAI model.
 */
export function resolveHelperModel(
  config: LlmConfig,
  env: Record<string, string | undefined> = process.env,
): GenerationModel {
  if (config.model) return { provider: "openai", model: config.model };
  return resolveTutorModel(helperKeys(config), env);
}

function helperKeys(config: LlmConfig) {
  return { openaiApiKey: config.apiKey || undefined, anthropicApiKey: config.anthropicApiKey || undefined };
}

export interface HelperJsonResult {
  content: string | undefined;
  tokenUsage: number;
  model: string;
}

/** One structured-output request on the helper model. Throws on provider errors. */
export async function requestHelperJson(
  config: LlmConfig,
  request: JsonRequest,
  env?: Record<string, string | undefined>,
): Promise<HelperJsonResult> {
  const model = resolveHelperModel(config, env);
  const response = await requestJson(model, helperKeys(config), request);
  if (response.error) throw new Error(response.error);
  return { content: response.content, tokenUsage: response.tokenUsage, model: modelLabel(model) };
}
