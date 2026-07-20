export const EXTRACTION_VERSION = "pdf-v2.0.0";

export type ExtractionProvider = "local-pdfjs" | "mistral-ocr" | "local-fallback";
export type ExtractionRoute = "local" | "ocr";
export type ExtractedBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "equation"
  | "image"
  | "caption"
  | "code";

export type BoundingBox = { x: number; y: number; width: number; height: number };

export type ExtractedImage = {
  id: string;
  mime: string;
  dataUrl?: string;
  storageUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type ExtractedBlock = {
  id: string;
  kind: ExtractedBlockKind;
  order: number;
  text?: string;
  markdown?: string;
  level?: 1 | 2 | 3;
  items?: string[];
  html?: string;
  table?: { rowCount: number; columnCount: number };
  latex?: string;
  image?: ExtractedImage;
  bbox?: BoundingBox;
  confidence?: number;
  runs?: Array<{ text: string; bold?: boolean; italic?: boolean }>;
};

export type PdfPageInspection = {
  pageNumber: number;
  route: ExtractionRoute;
  qualityScore: number;
  reasons: string[];
  textChars: number;
  replacementRate: number;
  columnCount: number;
  imageOps: number;
  vectorOps: number;
  mathSignals: number;
  tableSignals: number;
};

export type ExtractedPage = {
  pageNumber: number;
  width: number;
  height: number;
  provider: ExtractionProvider;
  qualityScore: number;
  blocks: ExtractedBlock[];
  markdown: string;
  inspection?: PdfPageInspection;
};

export type ExtractedDocument = {
  version: string;
  pageCount: number;
  pages: ExtractedPage[];
};
