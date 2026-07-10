import { type SourceType, parseGenerationSettings, isTopicSource, topicQueryFromSource } from "@deephaus/shared";
import { generateCardsFromChunks, generateCardsFromTopic, createMockCards } from "@deephaus/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSourceChunks,
  collectSegmentPageNumbers,
  filterChunksByIndices,
} from "@/lib/sources/chunks";
import {
  ensureSourceChunks,
  findChunkForPage,
  pageFromImageRef,
  type PersistedChunk,
} from "@/lib/sources/source-chunks";
import { extractSourceImages } from "@/lib/sources/extract-images";
import { buildOcclusionCardsFromImages, type OcclusionCardRow } from "@/lib/jobs/occlusion-cards";

const USE_MOCK_LLM = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

/** Optional override for the generation model; falls back to the package default. */
const GENERATION_MODEL = process.env.OPENAI_GENERATION_MODEL?.trim() || undefined;

/** Vision model used as the occlusion fallback when on-device OCR finds no labels. */
const OCCLUSION_VISION_MODEL =
  process.env.OPENAI_OCCLUSION_MODEL?.trim() || "gpt-4o";

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
  source_chunk_id: string | null;
  source_ref: string | null;
  source_quote: string | null;
};

function textCardMixLabel(cardTypes: ("basic" | "cloze")[]): string {
  if (cardTypes.length === 0) return "card";
  return cardTypes
    .map((t) => (t === "cloze" ? "fill-in-the-blank (cloze)" : "front/back (basic)"))
    .join(" or ");
}

/** Lowest sort_order in a deck, or null when the deck has no cards yet. */
async function deckMinSortOrder(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("cards")
    .select("sort_order, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", projectId)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.sort_order;
}

/** Place a new batch before existing cards (lower sort_order = earlier in the queue). */
function prependSortOrders(rows: CardRow[], existingMin: number | null): CardRow[] {
  const start = existingMin === null ? 0 : existingMin - rows.length;
  return rows.map((row, index) => ({
    ...row,
    sort_order: start + index,
  }));
}

/** Map selected text chunks to page/slide numbers for scoped occlusion scans. */
function pageNumbersForOcclusion(
  sourceType: SourceType,
  rawText: string,
  chunkIndices?: number[],
): number[] | undefined {
  if (sourceType !== "pdf" && sourceType !== "pptx") return undefined;
  const allChunks = buildSourceChunks(sourceType, rawText);
  const chunks = filterChunksByIndices(allChunks, chunkIndices);
  const pages = collectSegmentPageNumbers(
    chunks.map((chunk) => ({
      index: chunk.index,
      sourceRef: chunk.sourceRef,
      preview: "",
      charCount: 0,
    })),
  );
  return pages.length > 0 ? pages : undefined;
}

export async function processGenerationJob(
  jobId: string,
  supabase: SupabaseClient,
  options?: { chunkIndices?: number[]; scopeText?: string },
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
    const isTopic = isTopicSource(source);
    const scopeText = options?.scopeText?.trim() || "";
    const wantsText = settings.cardTypes.length > 0;
    // Selection-scoped runs are text-only — skip image occlusion for the highlight.
    const wantsOcclusion =
      !scopeText &&
      settings.autoImageOcclusion &&
      (sourceType === "pdf" || sourceType === "pptx" || sourceType === "docx");

    await updateJob("chunking", { progress: 10 });

    // Persist (and embed) source chunks so every generated card can link back to
    // the exact segment it came from. Idempotent; skipped for topic sources.
    let persistedChunks: PersistedChunk[] = [];
    const chunkById = new Map<number, PersistedChunk>();
    if (!isTopic) {
      persistedChunks = await ensureSourceChunks(supabase, {
        id: source.id,
        type: sourceType,
        raw_text: source.raw_text ?? null,
      });
      for (const chunk of persistedChunks) chunkById.set(chunk.chunk_index, chunk);
    }

    // ----- Text cards (front/back and/or cloze) --------------------------------
    const textRows: CardRow[] = [];
    let tokenUsage = 0;
    let generationDetail: string | undefined;

    if (wantsText) {
      const text = isTopic ? topicQueryFromSource(source) : (source.raw_text ?? "");
      if (!scopeText && !text.trim()) {
        throw new Error(
          isTopic
            ? "No topic available for generation."
            : "No text available for generation. The source may be empty or unsupported.",
        );
      }

      await updateJob("generating", { progress: 30 });

      let cards;
      const textProgressSpan = wantsOcclusion ? 45 : 60;

      if (isTopic) {
        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
          const sourceRef = `Topic::${text.slice(0, 40)}`;
          cards = settings.cardTypes.flatMap((type) => createMockCards(sourceRef, type));
        } else {
          const result = await generateCardsFromTopic(text, settings, {
            apiKey: process.env.OPENAI_API_KEY!,
            model: GENERATION_MODEL,
          });
          cards = result.cards;
          tokenUsage = result.tokenUsage;
          generationDetail = result.detail;
          void updateJob("generating", { progress: 30 + textProgressSpan });
        }
      } else if (scopeText) {
        if (scopeText.length < 20) {
          throw new Error(
            "Highlighted text is too short to generate useful flashcards (minimum 20 characters).",
          );
        }
        const needle = scopeText.slice(0, Math.min(120, scopeText.length));
        const allChunks = buildSourceChunks(sourceType, text || scopeText);
        const matchingBuilt =
          allChunks.find((chunk) => chunk.text.includes(needle)) ??
          allChunks.find((chunk) => needle.includes(chunk.text.slice(0, 80))) ??
          null;
        const matchingChunk =
          matchingBuilt != null ? chunkById.get(matchingBuilt.index) ?? null : null;
        const scopeChunk = {
          text: scopeText,
          sourceRef: matchingBuilt?.sourceRef ?? matchingChunk?.source_ref ?? "Selection::1",
          index: matchingBuilt?.index ?? matchingChunk?.chunk_index ?? 0,
        };

        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
          const mockQuote = scopeText.slice(0, 160);
          cards = settings.cardTypes
            .flatMap((type) => createMockCards(scopeChunk.sourceRef, type))
            .map((c) => ({
              ...c,
              sourceRef: scopeChunk.sourceRef,
              chunkIndex: scopeChunk.index,
              sourceQuote: mockQuote,
            }));
        } else {
          const result = await generateCardsFromChunks(
            [scopeChunk],
            settings,
            { apiKey: process.env.OPENAI_API_KEY!, model: GENERATION_MODEL },
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
            tags: settings.autoTags ? card.tags : [],
            sort_order: index,
            source_chunk_id: matchingChunk?.id ?? null,
            source_ref: card.sourceRef ?? matchingChunk?.source_ref ?? "Selection::1",
            source_quote: card.sourceQuote ?? scopeText.slice(0, 240),
          });
        }
      } else {
        const allChunks = buildSourceChunks(sourceType, text);
        const chunks = filterChunksByIndices(allChunks, options?.chunkIndices);
        if (chunks.length === 0) throw new Error("Could not chunk source text.");

        if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
          const sourceRef = chunks[0]?.sourceRef ?? "Notes";
          const firstIndex = chunks[0]?.index ?? 0;
          // Mock quotes: a verbatim slice of the chunk so source highlights work in dev.
          const mockQuote = chunks[0]?.text?.trim().slice(0, 160) || undefined;
          cards = settings.cardTypes
            .flatMap((type) => createMockCards(sourceRef, type))
            .map((c) => ({ ...c, sourceRef, chunkIndex: firstIndex, sourceQuote: mockQuote }));
        } else {
          const result = await generateCardsFromChunks(
            chunks,
            settings,
            { apiKey: process.env.OPENAI_API_KEY!, model: GENERATION_MODEL },
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
      }

      // Selection-scoped cards were already pushed above.
      if (!scopeText) for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        const linkedChunk =
          card.chunkIndex != null ? chunkById.get(card.chunkIndex) ?? null : null;
        textRows.push({
          job_id: jobId,
          type: card.type,
          front: card.type === "basic" ? (card.front ?? null) : null,
          back: card.type === "basic" ? (card.back ?? null) : null,
          cloze_text: card.type === "cloze" ? (card.clozeText ?? null) : null,
          extra: card.type === "cloze" ? (card.extra ?? null) : null,
          occlusion_data: null,
          // Hard guarantee: when auto-tags are off, drop tags even if the
          // model ignored the prompt instruction (also covers the mock path).
          tags: settings.autoTags ? card.tags : [],
          sort_order: index,
          source_chunk_id: linkedChunk?.id ?? null,
          source_ref: card.sourceRef ?? linkedChunk?.source_ref ?? null,
          source_quote: isTopic ? null : (card.sourceQuote ?? null),
        });
      }
    }

    // ----- Image-occlusion cards from document diagrams ------------------------
    let occlusionRows: OcclusionCardRow[] = [];
    let occlusionWarning: string | undefined;

    if (wantsOcclusion) {
      await updateJob("generating", { progress: wantsText ? 80 : 40 });

      if (!source.storage_path) {
        occlusionWarning =
          "Image occlusion skipped: the original file was not saved to storage. Re-upload the document to enable auto-occlusion.";
        console.warn("[processor] image-occlusion:", occlusionWarning);
      } else {
        try {
          const { data: fileBlob } = await supabase.storage
            .from(SOURCE_FILE_BUCKET)
            .download(source.storage_path);
          if (!fileBlob) {
            occlusionWarning =
              "Image occlusion skipped: could not download the original file from storage.";
            console.warn("[processor] image-occlusion:", occlusionWarning);
          } else {
            const buffer = Buffer.from(await fileBlob.arrayBuffer());
            const pageNumbers = isTopicSource(source)
              ? undefined
              : pageNumbersForOcclusion(
                  sourceType,
                  source.raw_text ?? "",
                  options?.chunkIndices,
                );
            const images = await extractSourceImages(buffer, sourceType, {
              pageNumbers,
            });

            if (images.length === 0) {
              occlusionWarning =
                sourceType === "docx"
                  ? "No embedded images were found in this Word document for image occlusion."
                  : "No pages or slides were available to scan for labeled diagrams.";
              console.warn("[processor] image-occlusion:", occlusionWarning);
            } else {
              const base = wantsText ? 82 : 45;
              const span = wantsText ? 13 : 50;
              const vision =
                !USE_MOCK_LLM && process.env.OPENAI_API_KEY
                  ? { apiKey: process.env.OPENAI_API_KEY, model: OCCLUSION_VISION_MODEL }
                  : undefined;
              const result = await buildOcclusionCardsFromImages(
                supabase,
                project.user_id,
                jobId,
                images,
                textRows.length,
                {
                  vision,
                  onProgress: (completed, total) => {
                    if (terminal) return;
                    const progress = base + Math.round((completed / total) * span);
                    void updateJob("generating", { progress });
                  },
                },
              );
              occlusionRows = result.rows;
              // Link each occlusion card to the chunk covering its page/slide.
              for (const row of occlusionRows) {
                const page = pageFromImageRef(row.source_ref);
                const chunk = page != null ? findChunkForPage(persistedChunks, page) : null;
                row.source_chunk_id = chunk?.id ?? null;
                row.source_ref = chunk?.source_ref ?? row.source_ref;
                if (!settings.autoTags) row.tags = [];
              }
              console.info(
                `[processor] image-occlusion: scanned ${result.stats.scanned}, created ${occlusionRows.length} (ocr=${result.stats.ocrCards}, vision=${result.stats.visionCards})`,
              );
              if (occlusionRows.length === 0) {
                occlusionWarning = `Scanned ${images.length} page(s)/slide(s)/figure(s) but found no readable text labels to occlude. Labels must be clear enough to detect.`;
                console.warn("[processor] image-occlusion:", occlusionWarning);
              }
            }
          }
        } catch (occlusionError) {
          occlusionWarning =
            occlusionError instanceof Error
              ? `Image occlusion failed: ${occlusionError.message}`
              : "Image occlusion failed unexpectedly.";
          console.warn("[processor] image-occlusion generation failed:", occlusionError);
        }
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
      const occlusionHint = occlusionWarning
        ? ` ${occlusionWarning}`
        : " No labeled diagrams were detected. Try a document with clear text labels on figures, or enable front/back or fill-in-the-blank cards.";
      throw new Error(
        `No image occlusion cards were created.${occlusionHint}`,
      );
    }

    const existingMin = await deckMinSortOrder(supabase, project.id);
    const rowsToInsert = prependSortOrders(rows, existingMin);

    const { error: insertError } = await supabase.from("cards").insert(rowsToInsert);
    if (insertError) throw insertError;

    terminal = true;
    await updateJob("ready", { progress: 100, token_usage: tokenUsage, error: null });
  } catch (error) {
    terminal = true;
    const message = error instanceof Error ? error.message : "Generation failed";
    await updateJob("failed", { error: message, progress: 100 });
  }
}
