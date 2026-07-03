import OpenAI from "openai";
import type { LlmConfig } from "./generate.js";

/** Dimension of text-embedding-3-small — must match the vector(N) column. */
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/** Embedding inputs are truncated so a single oversized chunk can't blow the token limit. */
const MAX_EMBED_CHARS = 8000;
/** OpenAI accepts batched inputs; keep batches modest to stay well under limits. */
const EMBED_BATCH_SIZE = 64;

export interface EmbedConfig extends LlmConfig {
  /** Embedding model override; defaults to text-embedding-3-small. */
  embeddingModel?: string;
}

function prepare(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_EMBED_CHARS);
}

/**
 * Embed an array of texts, preserving input order. Best-effort: on any API
 * failure (or empty input) the corresponding slots are returned as `null` so
 * callers can persist chunks without embeddings rather than failing outright.
 */
export async function embedTexts(
  texts: string[],
  config: EmbedConfig,
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  if (!config.apiKey) return texts.map(() => null);

  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const input = batch.map(prepare);
    try {
      const response = await client.embeddings.create({ model, input });
      response.data.forEach((item, i) => {
        results[start + i] = item.embedding;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "embedding request failed";
      console.warn(`[embeddings] batch ${start}-${start + batch.length} failed: ${message}`);
      // Leave this batch's slots as null and continue with the rest.
    }
  }

  return results;
}

/** Convenience for embedding a single query string; returns null on failure. */
export async function embedQuery(
  query: string,
  config: EmbedConfig,
): Promise<number[] | null> {
  const [embedding] = await embedTexts([query], config);
  return embedding ?? null;
}
