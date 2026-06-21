import { type SourceType, parseGenerationSettings } from "@deephaus/shared";
import { generateCardsFromChunks, createMockCards } from "@deephaus/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSourceChunks, filterChunksByIndices } from "@/lib/sources/chunks";
import { extractSourceImages } from "@/lib/sources/extract-images";
import { buildOcclusionCardsFromImages, type OcclusionCardRow } from "@/lib/jobs/occlusion-cards";

const USE_MOCK_LLM = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

/** Original document bucket (PDF/PowerPoint uploads) — see /api/sources/file. */
const SOURCE_FILE_BUCKET = "pdfs";

/** Uniform row shape so basic, cloze, and occlusion cards insert in one call. */
type CardRow = {
  job_id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: OcclusionCardRow["occlusion_data"] | null;
  tags: string[];
  sort_order: number;
};

function textCardMixLabel(cardTypes: ("basic" | "cloze")[]): string {
  if (cardTypes.length === 0) return "card";
  return cardTypes
    .map((t) => (t === "cloze" ? "fill-in-the-blank (cloze)" : "front/back (basic)"))
    .join(" or ");
}

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

    const sourceType = source.type as SourceType;
    const wantsText = settings.cardTypes.length > 0;
    const wantsOcclusion =
      settings.autoImageOcclusion &&
      (sourceType === "pdf" || sourceType === "pptx") &&
      Boolean(source.storage_path);

    await updateJob("chunking", { progress: 10 });

    // ----- Text cards (front/back and/or cloze) --------------------------------
    const textRows: CardRow[] = [];
    let tokenUsage = 0;
    let generationDetail: string | undefined;

    if (wantsText) {
      const text = source.raw_text ?? "";
      if (!text.trim()) {
        throw new Error(
          "No text available for generation. The source may be empty or unsupported.",
        );
      }

      const allChunks = buildSourceChunks(sourceType, text);
      const chunks = filterChunksByIndices(allChunks, options?.chunkIndices);
      if (chunks.length === 0) throw new Error("Could not chunk source text.");

      await updateJob("generating", { progress: 30 });

      let cards;
      // Leave headroom in the progress bar for occlusion detection if it runs.
      const textProgressSpan = wantsOcclusion ? 45 : 60;
      if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
        cards = createMockCards(chunks[0]?.sourceRef ?? "Notes", settings.cardMix);
      } else {
        const result = await generateCardsFromChunks(
          chunks,
          settings,
          { apiKey: process.env.OPENAI_API_KEY! },
          (completed, total) => {
            if (terminal) return;
            const progress = 30 + Math.round((completed / total) * textProgressSpan);
            void updateJob("generating", { progress });
          },
        );
        cards = result.cards;
        tokenUsage = result.tokenUsage;
        generationDetail = result.detail;
      }

      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        textRows.push({
          job_id: jobId,
          type: card.type,
          front: card.type === "basic" ? (card.front ?? null) : null,
          back: card.type === "basic" ? (card.back ?? null) : null,
          cloze_text: card.type === "cloze" ? (card.clozeText ?? null) : null,
          extra: card.type === "cloze" ? (card.extra ?? null) : null,
          occlusion_data: null,
          tags: card.tags,
          sort_order: index,
        });
      }
    }

    // ----- Image-occlusion cards from document diagrams ------------------------
    let occlusionRows: OcclusionCardRow[] = [];
    if (wantsOcclusion && source.storage_path) {
      await updateJob("generating", { progress: wantsText ? 80 : 40 });
      try {
        const { data: fileBlob } = await supabase.storage
          .from(SOURCE_FILE_BUCKET)
          .download(source.storage_path);
        if (fileBlob) {
          const buffer = Buffer.from(await fileBlob.arrayBuffer());
          const images = await extractSourceImages(buffer, sourceType);
          if (images.length > 0) {
            const base = wantsText ? 82 : 45;
            const span = wantsText ? 13 : 50;
            occlusionRows = await buildOcclusionCardsFromImages(
              supabase,
              project.user_id,
              jobId,
              images,
              textRows.length,
              (completed, total) => {
                if (terminal) return;
                const progress = base + Math.round((completed / total) * span);
                void updateJob("generating", { progress });
              },
            );
          }
        }
      } catch (occlusionError) {
        // Never fail the whole job because diagram extraction stumbled.
        console.warn("[processor] image-occlusion generation failed:", occlusionError);
      }
    }

    const rows: CardRow[] = [...textRows, ...occlusionRows];

    if (rows.length === 0) {
      if (wantsText) {
        const detail = generationDetail ? ` ${generationDetail}` : "";
        throw new Error(
          `No valid ${textCardMixLabel(settings.cardTypes)} cards were generated from this source.${detail}`,
        );
      }
      throw new Error(
        "No diagrams suitable for image occlusion were found in this document. Try enabling front/back or fill-in-the-blank cards too.",
      );
    }

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
