export type { CardRichTextContent, ClozeRenderMode } from "./types.js";

export {
  getCardEditorExtensions,
  ClozeMark,
  LatexBlock,
  LatexInline,
} from "./extensions/index.js";

export {
  richTextToHtml,
  richTextToPlainText,
  richTextToPlainTextWithClozeMode,
  htmlToRichTextJson,
  sanitizeCardHtml,
  emptyRichTextDoc,
  isEmptyRichTextDoc,
  applyClozeModeToJson,
  richTextToHtmlWithClozeMode,
} from "./serialize/html.js";

export { richTextToMarkdown } from "./serialize/markdown.js";

export {
  markdownToRichText,
  markdownToRichTextJson,
  buildCardRichTextContent,
  normalizeEditorValue,
} from "./serialize/from-markdown.js";

export { clozeToMarkdown, parseClozeMarkdown, nextClozeId, CLOZE_IDS } from "./extensions/cloze.js";
export { clozeClassName, clozeNumber, MAX_CLOZE_ID, isValidClozeId } from "./extensions/cloze-colors.js";
