import { MAX_PDF_BYTES, MAX_SOURCE_FILE_BYTES, MAX_VIDEO_BYTES } from "@deephaus/shared";
import type { GoogleDriveFileSummary } from "@/components/google-drive-picker";
import type { NotionPageSummary } from "@/components/notion-page-picker";
import { detectSourceFileKind, fileExtension } from "@/lib/sources/file-types";
import { titleFromText, truncateTitle } from "@/lib/sources/text-title";
import { parseYouTubeVideoId } from "@/lib/youtube/parse";

/**
 * Sources attached to a Create composer draft. Each one becomes a deck source
 * when the message is sent.
 */
export type ComposerAttachment =
  | { id: string; kind: "document"; file: File; extractImages: boolean }
  | { id: string; kind: "video"; file: File }
  | { id: string; kind: "youtube"; url: string }
  | { id: string; kind: "website"; url: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "notion"; page: NotionPageSummary }
  | { id: string; kind: "drive"; file: GoogleDriveFileSummary };

/** Shortest pasted text that is worth storing as a source. */
export const MIN_SOURCE_TEXT_CHARS = 20;
/** Pastes at least this long become a source chip instead of message text. */
export const PASTE_AS_SOURCE_MIN_CHARS = 1200;

const MAX_FILE_MB = MAX_SOURCE_FILE_BYTES / (1024 * 1024);
const MAX_PDF_MB = MAX_PDF_BYTES / (1024 * 1024);
const MAX_VIDEO_MB = MAX_VIDEO_BYTES / (1024 * 1024);
// Keep PDF uploads on the hybrid worker by default so mathematical notation is
// reconstructed by OCR instead of flattened by the legacy text-only parser.
const PDF_EXTRACTION_V2 = process.env.NEXT_PUBLIC_PDF_EXTRACTION_V2 !== "false";

export const DOCUMENT_SIZE_HINT = `PDF, Word, PowerPoint, Excel · up to ${
  PDF_EXTRACTION_V2 ? MAX_PDF_MB : MAX_FILE_MB
} MB`;
export const VIDEO_SIZE_HINT = `MP4, WebM, MOV · up to ${MAX_VIDEO_MB} MB`;

export function newAttachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function stripFileExtension(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "");
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Turn a picked or dropped file into an attachment, or explain why it can't be used. */
export function attachmentFromFile(
  file: File,
): { attachment: ComposerAttachment } | { error: string } {
  const kind = detectSourceFileKind(file.name, file.type);
  if (kind === "document") {
    const hybridPdf = PDF_EXTRACTION_V2 && isPdfFile(file);
    const maxBytes = hybridPdf ? MAX_PDF_BYTES : MAX_SOURCE_FILE_BYTES;
    if (file.size > maxBytes) {
      return { error: `${file.name} is too large. Files must be under ${hybridPdf ? MAX_PDF_MB : MAX_FILE_MB} MB.` };
    }
    return { attachment: { id: newAttachmentId(), kind: "document", file, extractImages: true } };
  }
  if (kind === "video") {
    if (file.size > MAX_VIDEO_BYTES) {
      return { error: `${file.name} is too large. Videos must be under ${MAX_VIDEO_MB} MB.` };
    }
    return { attachment: { id: newAttachmentId(), kind: "video", file } };
  }
  return {
    error: `${file.name} isn't a supported file. Use a PDF, Word, PowerPoint, or Excel document, or a video.`,
  };
}

/** A pasted or typed http(s) link → YouTube or website attachment. */
export function attachmentFromUrl(raw: string): ComposerAttachment | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (parseYouTubeVideoId(value)) {
    return { id: newAttachmentId(), kind: "youtube", url: value };
  }
  return { id: newAttachmentId(), kind: "website", url: value };
}

export function attachmentIcon(attachment: ComposerAttachment): string {
  switch (attachment.kind) {
    case "document":
      return "ri-file-text-line";
    case "video":
      return "ri-video-line";
    case "youtube":
      return "ri-youtube-line";
    case "website":
      return "ri-global-line";
    case "text":
      return "ri-align-left";
    case "notion":
      return "ri-notion-line";
    case "drive":
      return "ri-cloud-line";
  }
}

export function attachmentTitle(attachment: ComposerAttachment): string {
  switch (attachment.kind) {
    case "document":
    case "video":
      return attachment.file.name;
    case "youtube":
      return "YouTube video";
    case "website":
      return hostnameOf(attachment.url);
    case "text":
      return titleFromText(attachment.text, 44) || "Pasted text";
    case "notion":
      return attachment.page.title?.trim() || "Notion page";
    case "drive":
      return attachment.file.name?.trim() || "Google Drive file";
  }
}

export function attachmentDetail(attachment: ComposerAttachment): string {
  switch (attachment.kind) {
    case "document": {
      const ext = fileExtension(attachment.file.name).replace(".", "").toUpperCase() || "Document";
      return `${ext} · ${formatBytes(attachment.file.size)}`;
    }
    case "video":
      return `Video · ${formatBytes(attachment.file.size)}`;
    case "youtube":
      return truncateTitle(attachment.url.replace(/^https?:\/\/(www\.)?/, ""), 34);
    case "website":
      return "Website";
    case "text":
      return `Pasted text · ${attachment.text.length.toLocaleString()} characters`;
    case "notion":
      return "Notion page";
    case "drive":
      return "Google Drive";
  }
}

/** Deck name suggested for a brand-new deck, from the first source or the message. */
export function suggestDeckName(attachments: ComposerAttachment[], message: string): string {
  const first = attachments[0];
  if (!first) return truncateTitle(message) || "New deck";
  switch (first.kind) {
    case "document":
    case "video":
      return stripFileExtension(first.file.name) || "Imported deck";
    case "youtube":
      return "YouTube import";
    case "website":
      return hostnameOf(first.url) || "Website import";
    case "text":
      return titleFromText(first.text) || "Text notes";
    case "notion":
      return first.page.title?.trim() || "Notion import";
    case "drive":
      return first.file.name?.trim() || "Google Drive import";
  }
}
