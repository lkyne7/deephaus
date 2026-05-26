import { type SourceType, parseGenerationSettings } from "@deephaus/shared";
import { generateCardsFromChunks, createMockCards } from "@deephaus/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSourceChunks, filterChunksByIndices } from "@/lib/sources/chunks";

const USE_MOCK_LLM = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

export async function processGenerationJob(
  jobId: string,
  supabase: SupabaseClient,
  options?: { chunkIndices?: number[] },
) {
  let terminal = false;

  const updateJob = async (
    status: string,
    fields: Record<string, unknown> = {},
  ) => {
    if (terminal && status !== "failed" && status !== "ready") return;
    await supabase
      .from("generation_jobs")
      .update({ status, updated_at: new Date().toISOString(), ...fields })
      .eq("id", jobId);
  };

  try {
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .select("*, sources(*, projects(*))")
      .eq("id", jobId)
      .single();

    if (jobError || !job) throw new Error("Job not found");

    const source = job.sources;
    const project = source.projects;
    const settings = parseGenerationSettings(
      project.settings ?? {
        cardMix: "basic",
        detailLevel: "medium",
      },
    );

    await updateJob("chunking", { progress: 10 });

    let text = source.raw_text ?? "";
    if (!text.trim()) {
      throw new Error("No text available for generation. The source may be empty or unsupported.");
    }

    const allChunks = buildSourceChunks(source.type as SourceType, text);
    const chunks = filterChunksByIndices(allChunks, options?.chunkIndices);

    if (chunks.length === 0) throw new Error("Could not chunk source text.");

    await updateJob("generating", { progress: 30 });

    let cards;
    let tokenUsage = 0;
    let generationDetail: string | undefined;

    if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
      cards = createMockCards(chunks[0]?.sourceRef ?? "Notes", settings.cardMix);
    } else {
      const result = await generateCardsFromChunks(
        chunks,
        settings,
        { apiKey: process.env.OPENAI_API_KEY! },
        (completed, total) => {
          if (terminal) return;
          const progress = 30 + Math.round((completed / total) * 60);
          void updateJob("generating", { progress });
        },
      );
      cards = result.cards;
      tokenUsage = result.tokenUsage;
      generationDetail = result.detail;
    }

    if (cards.length === 0) {
      const mixLabel = settings.cardMix === "cloze" ? "fill-in-the-blank (cloze)" : "front/back (basic)";
      const detail = generationDetail ? ` ${generationDetail}` : "";
      throw new Error(
        `No valid ${mixLabel} cards were generated from this source.${detail}`,
      );
    }

    const rows = cards.map((card, index) =>
      card.type === "basic"
        ? {
            job_id: jobId,
            type: "basic",
            front: card.front,
            back: card.back,
            extra: null,
            tags: card.tags,
            sort_order: index,
          }
        : {
            job_id: jobId,
            type: "cloze",
            cloze_text: card.clozeText,
            extra: card.extra ?? null,
            tags: card.tags,
            sort_order: index,
          },
    );

    const { error: insertError } = await supabase.from("cards").insert(rows);
    if (insertError) throw insertError;

    terminal = true;
    await updateJob("ready", { progress: 100, token_usage: tokenUsage, error: null });
  } catch (error) {
    terminal = true;
    const message = error instanceof Error ? error.message : "Generation failed";
    await updateJob("failed", { error: message, progress: 100 });
  }
}
