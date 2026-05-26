import type { SourceType } from "@deephaus/shared";
import { extractPdfText } from "@/lib/pdf/extract";
import { extractDocxText } from "@/lib/docx/extract";
import { extractPptxText } from "@/lib/pptx/extract";
import { transcribeMedia } from "@/lib/video/transcribe";
import { detectSourceType, fileExtension } from "@/lib/sources/file-types";

export type ExtractedSource = {
  sourceType: SourceType;
  text: string;
  pageCount: number | null;
};

export async function extractSourceFromFile(
  buffer: Buffer,
  filename: string,
  mimeType = "",
  options?: { skipVideoTranscription?: boolean; rawText?: string | null },
): Promise<ExtractedSource> {
  const sourceType = detectSourceType(filename, mimeType);
  if (!sourceType) {
    throw new Error(
      "Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), or a common video format.",
    );
  }

  if (sourceType === "docx" && fileExtension(filename) === ".doc") {
    throw new Error(
      "Legacy .doc files are not supported. Open the file in Word and save as .docx.",
    );
  }

  if (sourceType === "video") {
    if (options?.rawText?.trim()) {
      return { sourceType, text: options.rawText.trim(), pageCount: null };
    }
    if (options?.skipVideoTranscription) {
      throw new Error("Video transcript is required.");
    }
    const transcribed = await transcribeMedia(buffer, filename);
    return { sourceType, text: transcribed.text, pageCount: transcribed.segmentCount };
  }

  switch (sourceType) {
    case "pdf": {
      const extracted = await extractPdfText(buffer);
      return { sourceType, text: extracted.text, pageCount: extracted.pageCount };
    }
    case "docx": {
      const extracted = await extractDocxText(buffer);
      return { sourceType, text: extracted.text, pageCount: extracted.pageCount };
    }
    case "pptx": {
      const extracted = await extractPptxText(buffer);
      return { sourceType, text: extracted.text, pageCount: extracted.pageCount };
    }
    default:
      throw new Error("Unsupported source type.");
  }
}
