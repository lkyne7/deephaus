import { chunkPdfPages, chunkText, type GenerationSettings } from "@sluggo/shared";
import { generateCardsFromChunks, createMockCards } from "@sluggo/llm";
import { createServiceClient } from "@/lib/supabase/server";

const USE_MOCK_LLM = process.env.SLUGGO_USE_MOCK_LLM === "true";

export async function processGenerationJob(jobId: string) {
  const supabase = createServiceClient();

  const updateJob = async (
    status: string,
    fields: Record<string, unknown> = {},
  ) => {
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
    const settings = (project.settings ?? {
      cardMix: "both",
      density: 5,
    }) as GenerationSettings;

    await updateJob("chunking", { progress: 10 });

    let text = source.raw_text ?? "";
    if (!text.trim()) {
      throw new Error("No text available for generation. PDF may be scanned or empty.");
    }

    const pages =
      source.type === "pdf"
        ? text
            .split(/\n--- Page \d+ ---\n/)
            .map((p: string) => p.trim())
            .filter(Boolean)
        : [];

    const chunks =
      source.type === "pdf" && pages.length > 0
        ? chunkPdfPages(pages, "PDF")
        : chunkText(text, "Notes");

    if (chunks.length === 0) throw new Error("Could not chunk source text.");

    await updateJob("generating", { progress: 30 });

    let cards;
    let tokenUsage = 0;

    if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
      cards = createMockCards(chunks[0]?.sourceRef ?? "Notes");
    } else {
      const result = await generateCardsFromChunks(
        chunks,
        settings,
        { apiKey: process.env.OPENAI_API_KEY! },
        (completed, total) => {
          const progress = 30 + Math.round((completed / total) * 60);
          void updateJob("generating", { progress });
        },
      );
      cards = result.cards;
      tokenUsage = result.tokenUsage;
    }

    if (cards.length === 0) {
      throw new Error("No valid cards were generated from this source.");
    }

    const rows = cards.map((card, index) =>
      card.type === "basic"
        ? {
            job_id: jobId,
            type: "basic",
            front: card.front,
            back: card.back,
            extra: card.extra ?? null,
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

    await updateJob("ready", { progress: 100, token_usage: tokenUsage, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    await updateJob("failed", { error: message, progress: 100 });
  }
}

export function enqueueGenerationJob(jobId: string) {
  setImmediate(() => {
    void processGenerationJob(jobId);
  });
}
