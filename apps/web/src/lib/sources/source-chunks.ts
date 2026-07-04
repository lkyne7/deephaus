import type { SupabaseClient } from "@supabase/supabase-js";
import { type SourceType } from "@deephaus/shared";
import { embedTexts } from "@deephaus/llm";
import {
  buildSourceChunks,
  formatSegmentLabel,
  parseSegmentPageRange,
} from "@/lib/sources/chunks";

const USE_MOCK_LLM = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

/** Minimal persisted-chunk shape used to link generated cards back to a segment. */
export type PersistedChunk = {
  id: string;
  chunk_index: number;
  source_ref: string;
  page_start: number | null;
  page_end: number | null;
};

/** pgvector accepts a bracketed string literal for input (e.g. "[0.1,0.2]"). */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function embedConfig() {
  if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) return null;
  return { apiKey: process.env.OPENAI_API_KEY };
}

async function loadPersistedChunks(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<PersistedChunk[]> {
  const { data } = await supabase
    .from("source_chunks")
    .select("id, chunk_index, source_ref, page_start, page_end")
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: true });
  return (data ?? []) as PersistedChunk[];
}

/**
 * Ensure a source's text is chunked, embedded, and persisted in `source_chunks`.
 * Idempotent — returns existing rows if already persisted. Best-effort: any
 * failure logs and returns whatever exists so generation is never blocked.
 */
export async function ensureSourceChunks(
  supabase: SupabaseClient,
  source: { id: string; type: SourceType; raw_text: string | null },
): Promise<PersistedChunk[]> {
  try {
    const existing = await loadPersistedChunks(supabase, source.id);
    if (existing.length > 0) return existing;

    const text = source.raw_text ?? "";
    const chunks = buildSourceChunks(source.type, text);
    if (chunks.length === 0) return [];

    const config = embedConfig();
    const embeddings = config
      ? await embedTexts(
          chunks.map((c) => c.text),
          config,
        )
      : chunks.map(() => null);

    const rows = chunks.map((chunk, i) => {
      const range = parseSegmentPageRange(chunk.sourceRef);
      const embedding = embeddings[i];
      return {
        source_id: source.id,
        chunk_index: chunk.index,
        source_ref: chunk.sourceRef,
        label: formatSegmentLabel(chunk.sourceRef, source.type),
        content: chunk.text,
        page_start: range?.start ?? null,
        page_end: range?.end ?? null,
        char_count: chunk.text.length,
        embedding: embedding ? toVectorLiteral(embedding) : null,
      };
    });

    const { error } = await supabase
      .from("source_chunks")
      .upsert(rows, { onConflict: "source_id,chunk_index" });
    if (error) {
      console.warn("[source-chunks] upsert failed:", error.message);
    }

    return await loadPersistedChunks(supabase, source.id);
  } catch (err) {
    console.warn("[source-chunks] ensureSourceChunks failed:", err);
    return [];
  }
}

/** Map a 1-based page/slide number to the persisted chunk that covers it. */
export function findChunkForPage(
  chunks: PersistedChunk[],
  page: number,
): PersistedChunk | null {
  for (const chunk of chunks) {
    const start = chunk.page_start ?? null;
    const end = chunk.page_end ?? start;
    if (start != null && end != null && page >= start && page <= end) {
      return chunk;
    }
  }
  return null;
}

/** Parse a leading integer out of an occlusion image ref like "Page 4" / "Slide 2". */
export function pageFromImageRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const match = ref.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
