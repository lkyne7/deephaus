# Rich text card editing

DeepHaus card fields can be edited with `<InlineCardEditor />` and rendered with `<CardContentRenderer />`.

## Storage model

Persist the full payload returned by `onChange`:

```ts
type CardRichTextContent = {
  json: unknown;      // Tiptap document — source of truth for round-trips
  html: string;       // sanitized HTML snapshot
  markdown: string;   // portable text with Anki clozes + LaTeX
  plainText: string;  // search / previews
};
```

**Recommended:** store `markdown` in existing text columns (`front`, `back`, `extra`, `cloze_text`) for backward compatibility, or store `json` in a JSONB column when available.

## Editor

Use `CardFieldEditor` anywhere a card field is edited (Browse, deck detail). It wraps `InlineCardEditor` with a label and image upload.

```tsx
import { CardFieldEditor } from "@/components/card-field-editor";

<CardFieldEditor
  label="Front"
  cardId={card.id}
  value={frontMarkdown}
  placeholder="Question"
  onChange={(markdown) => save(markdown)}
/>
```

Or use `InlineCardEditor` directly when image upload is not needed:

```tsx
import { InlineCardEditor } from "@/components/rich-text/inline-card-editor";

<InlineCardEditor
  value={fieldMarkdown}
  placeholder="Extra notes…"
  onChange={(content) => save(content.markdown)}
/>
```

### Features

- Formatting: bold, italic, underline, code, lists, blockquote, headings (h2/h3)
- **Cloze:** select text → toolbar **C** or `⌘⇧C` → exports as `{{c1::text}}` / `{{c1::text::hint}}`
- **LaTeX:** toolbar **∑** (inline `$…$`) and **∫** (block `$$…$$`), rendered with KaTeX
- **Markdown paste:** plain-text Markdown pasted into the editor is converted when it looks like Markdown

## Read-only rendering

```tsx
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";

<CardContentRenderer content={savedMarkdown} clozeMode="hidden" />
```

`clozeMode`: `hidden` | `revealed` | `none`

## Conversion utilities (`@deephaus/rich-text`)

- `markdownToRichText(markdown)`
- `richTextToMarkdown(json)`
- `richTextToHtml(json)`
- `richTextToPlainText(json)`
- `buildCardRichTextContent(json)`

## Safety

HTML is sanitized with a jsdom-free allowlist sanitizer in `@deephaus/rich-text` before any read-only DOM insertion. Scripts, event handlers, and unknown tags are stripped.

## Limitations

- Legacy image markdown (`![](url)`) in plain fields is handled by `CardContent`, not this editor yet
- Collaborative editing and comments are not supported
- Block LaTeX editing uses insert commands; double-click formula editing is not implemented
