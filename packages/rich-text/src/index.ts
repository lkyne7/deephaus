export type { CardRichTextContent, ClozeRenderMode } from "./types.js";

export {
  getCardEditorExtensions,
  ClozeMark,
  LatexBlock,
  LatexInline,
  ResizableImage,
  clampImageDisplayWidth,
  normalizeImageAspectRatio,
  MIN_IMAGE_DISPLAY_WIDTH,
  MAX_IMAGE_DISPLAY_WIDTH,
  type ResizableImageAction,
  type ResizableImageAttributes,
} from "./extensions/index.js";

export {
  getSourceDocumentExtensions,
  type SourceDocumentExtensionOptions,
} from "./extensions/source-document.js";

export { Callout, CALLOUT_EMOJIS } from "./extensions/callout.js";
export { Toggle, ToggleContent, ToggleSummary } from "./extensions/toggle.js";
export {
  SlashCommand,
  filterSlashItems,
  type SlashCommandItem,
  type SlashCommandOptions,
} from "./extensions/slash-command.js";

export {
  sourceDocToHtml,
  sourceDocToPlainText,
  emptySourceDoc,
  isEmptySourceDoc,
} from "./serialize/source-doc.js";

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
  MARKDOWN_PASTE_PATTERN,
  looksLikeMarkdownPaste,
} from "./serialize/from-markdown.js";

export { clozeToMarkdown, parseClozeMarkdown, nextClozeId, CLOZE_IDS } from "./extensions/cloze.js";
export { clozeClassName, clozeNumber, MAX_CLOZE_ID, isValidClozeId } from "./extensions/cloze-colors.js";
export {
  handleRichTextKeydown,
  richTextEditorKeydownProps,
  type RichTextKeydownOptions,
} from "./editor-keydown.js";

export {
  RICH_TEXT_REQUEST_LINK_EVENT,
  normalizeLinkHref,
  applyLinkMark,
  unsetLinkMark,
} from "./link.js";

export {
  TEXT_COLORS,
  setLastTextColor,
  getLastTextColor,
  applyTextColor,
  applyLastTextColor,
} from "./text-color.js";
