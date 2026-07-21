import type { SourceType } from "@deephaus/shared";
import { stripNullBytes } from "@deephaus/pdf-extraction";
import { extractPdfText } from "@/lib/pdf/extract";
import { extractDocxText } from "@/lib/docx/extract";
import { extractPptxText } from "@/lib/pptx/extract";
import { extractXlsxText } from "@/lib/xlsx/extract";
import { transcribeMedia } from "@/lib/video/transcribe";
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
    const transcribed = await transcribeMedia(buffer, filename);
    return {
      sourceType,
      text: cleanExtractedText(transcribed.text),
      pageCount: transcribed.segmentCount,
    };
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
