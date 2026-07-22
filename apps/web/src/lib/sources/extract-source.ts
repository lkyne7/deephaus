import type { SourceType } from "@deephaus/shared";
import { stripNullBytes } from "@deephaus/pdf-extraction";
import { parseBuffer } from "music-metadata";
import {
  releaseAiCredits,
  reserveAiCredits,
  settleAiCredits,
} from "@/lib/credits/service";
import { extractPdfText } from "@/lib/pdf/extract";
import { extractDocxText } from "@/lib/docx/extract";
import { extractPptxText } from "@/lib/pptx/extract";
import { extractXlsxText } from "@/lib/xlsx/extract";
import {
  transcribeMedia,
  transcriptionUsesPaidProvider,
} from "@/lib/video/transcribe";
import { detectSourceType, fileExtension } from "@/lib/sources/file-types";

export type ExtractedSource = {
  sourceType: SourceType;
  text: string;
  pageCount: number | null;
};

/** Postgres rejects U+0000 in text/jsonb — strip before any DB write. */
function cleanExtractedText(text: string): string {
  return stripNullBytes(text);
}

export async function extractSourceFromFile(
  buffer: Buffer,
  filename: string,
  mimeType = "",
  options?: {
    skipVideoTranscription?: boolean;
    rawText?: string | null;
    pageCount?: number | null;
    creditContext?: {
      userId: string;
      idempotencyKey: string;
    };
  },
): Promise<ExtractedSource> {
  const sourceType = detectSourceType(filename, mimeType);
  if (!sourceType) {
    throw new Error(
      "Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), or a common video format.",
    );
  }

  if (sourceType === "docx" && fileExtension(filename) === ".doc") {
    throw new Error(
      "Legacy .doc files are not supported. Open the file in Word and save as .docx.",
    );
  }

  if (options?.rawText?.trim()) {
    return {
      sourceType,
      text: cleanExtractedText(options.rawText.trim()),
      pageCount: options.pageCount ?? null,
    };
  }

  if (sourceType === "video") {
    if (options?.rawText?.trim()) {
      return {
        sourceType,
        text: cleanExtractedText(options.rawText.trim()),
        pageCount: null,
      };
    }
    if (options?.skipVideoTranscription) {
      throw new Error("Video transcript is required.");
    }
    if (!transcriptionUsesPaidProvider()) {
      const transcribed = await transcribeMedia(buffer, filename);
      return {
        sourceType,
        text: cleanExtractedText(transcribed.text),
        pageCount: transcribed.segmentCount,
      };
    }

    if (!options?.creditContext) {
      throw new Error("Billing context is required for video transcription.");
    }

    const metadata = await parseBuffer(
      buffer,
      mimeType || undefined,
      { duration: true, skipCovers: true },
    );
    const durationSeconds = metadata.format.duration;
    if (
      typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new Error("Could not determine the media duration before transcription.");
    }

    const chargedCredits = Math.max(1, Math.ceil(durationSeconds / 60)) * 6;
    await reserveAiCredits({
      userId: options.creditContext.userId,
      idempotencyKey: options.creditContext.idempotencyKey,
      action: "video_transcription",
      reservedCredits: chargedCredits,
      metadata: {
        filename,
        duration_seconds: durationSeconds,
      },
    });

    try {
      const transcribed = await transcribeMedia(buffer, filename);
      await settleAiCredits({
        userId: options.creditContext.userId,
        idempotencyKey: options.creditContext.idempotencyKey,
        chargedCredits,
      });
      return {
        sourceType,
        text: cleanExtractedText(transcribed.text),
        pageCount: transcribed.segmentCount,
      };
    } catch (error) {
      await releaseAiCredits({
        userId: options.creditContext.userId,
        idempotencyKey: options.creditContext.idempotencyKey,
      }).catch(() => undefined);
      throw error;
    }
  }

  switch (sourceType) {
    case "pdf": {
      const extracted = await extractPdfText(buffer);
      return {
        sourceType,
        text: cleanExtractedText(extracted.text),
        pageCount: extracted.pageCount,
      };
    }
    case "docx": {
      const extracted = await extractDocxText(buffer);
      return {
        sourceType,
        text: cleanExtractedText(extracted.text),
        pageCount: extracted.pageCount,
      };
    }
    case "pptx": {
      const extracted = await extractPptxText(buffer);
      return {
        sourceType,
        text: cleanExtractedText(extracted.text),
        pageCount: extracted.pageCount,
      };
    }
    case "xlsx": {
      const extracted = await extractXlsxText(buffer);
      return {
        sourceType,
        text: cleanExtractedText(extracted.text),
        pageCount: extracted.pageCount,
      };
    }
    default:
      throw new Error("Unsupported source type.");
  }
}
