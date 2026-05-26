import type { SourceType } from "@deephaus/shared";
import { MAX_SOURCE_FILE_BYTES, MAX_VIDEO_BYTES } from "@deephaus/shared";

export type SourceFileKind = "document" | "video";

const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".doc"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mpeg", ".mpg", ".mkv"]);

const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-powerpoint",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "video/mpeg",
  "video/x-matroska",
]);

export const DOCUMENT_ACCEPT =
  ".pdf,.docx,.pptx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword";

export const VIDEO_ACCEPT =
  ".mp4,.webm,.mov,.m4v,.mpeg,.mpg,.mkv,video/mp4,video/webm,video/quicktime,video/x-m4v,video/mpeg,video/x-matroska";

export function fileExtension(filename: string): string {
  const match = filename.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function detectSourceFileKind(filename: string, mimeType = ""): SourceFileKind | null {
  const ext = fileExtension(filename);
  const mime = mimeType.toLowerCase();

  if (DOCUMENT_EXTENSIONS.has(ext) || DOCUMENT_MIMES.has(mime)) return "document";
  if (VIDEO_EXTENSIONS.has(ext) || VIDEO_MIMES.has(mime) || mime.startsWith("video/")) return "video";
  return null;
}

export function detectSourceType(filename: string, mimeType = ""): SourceType | null {
  const ext = fileExtension(filename);
  const mime = mimeType.toLowerCase();

  if (ext === ".pdf" || mime === "application/pdf") return "pdf";
  if (
    ext === ".docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    ext === ".pptx" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (ext === ".doc" || mime === "application/msword") return "docx";
  if (detectSourceFileKind(filename, mimeType) === "video") return "video";
  return null;
}

export function sourceTypeLabel(type: SourceType): string {
  switch (type) {
    case "pdf":
      return "PDF";
    case "docx":
      return "Word";
    case "pptx":
      return "PowerPoint";
    case "video":
      return "Video";
    case "youtube":
      return "YouTube";
    case "text":
      return "Text";
  }
}

export function maxBytesForSourceType(type: SourceType): number {
  return type === "video" ? MAX_VIDEO_BYTES : MAX_SOURCE_FILE_BYTES;
}
