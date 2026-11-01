# Native rich text card editor

Scope: the card editor on iOS and Android (`apps/mobile/components/card-editor`). Cards keep storing markdown; only the editing surface changed.

## Architecture

- `rich-field-dom.tsx` is an Expo DOM component (`"use dom"`). It runs the same Tiptap setup as the web editor (`getCardEditorExtensions` from `@deephaus/rich-text`) inside `@expo/dom-webview`, converts the stored markdown with `markdownToRichTextJson` on load and emits `richTextToMarkdown` on every change. Both apps therefore write identical markdown, so the database, PowerSync replica, study rendering and offline writes are untouched.
- `rich-field-types.ts` declares the bridge contract: `RichFieldState` (formatting under the cursor, cloze id and hint, undo availability, caret box) flows web → native after each transaction; `RichFieldHandle` is the native → web command surface, exposed with `useDOMImperativeHandle`. Arguments cross the bridge as JSON.
- `card-field-editor.tsx` owns one field: label row with image and audio shortcuts, the framed web view (`dom.matchContents` sizes it to its content; the outer `ScrollView` does the scrolling), upload and text-to-speech flows that insert at the cursor, and the echo check that stops a round-tripped `value` prop from resetting the editor. Until the editor reports its first state the frame shows the markdown natively (`RichCardContent` with the editor's padding and font metrics) and the web view loads behind it, absolutely positioned at the frame's width and invisible; the first state swaps them. WebKit spends roughly two seconds on the iOS simulator starting a WebContent process per web view before the page can even begin navigating (the dev bundle itself loads and boots in about 0.4 s), and nothing on the JS side shortens that, so the placeholder is what makes the text appear immediately.
- `editor-toolbar-context.tsx` tracks the focused field. `editor-keyboard-toolbar.tsx` renders the formatting bar above the keyboard (bold, italic, underline, strikethrough, code, lists, cloze, formula, image, audio, undo, redo, hide keyboard) and the cloze row (C1–C7, hint, remove). The bar shows only while the software keyboard is up: a web view can keep ProseMirror focus without a keyboard after a native modal.
- `components/ui/text-prompt-modal.tsx` is the cross-platform prompt used for cloze hints and LaTeX formulas. Tapping an existing formula in the editor reopens it.
- `card-editor-screen.tsx` provides the toolbar context and scrolls the caret into view from the caret box the editor reports, measured against the keyboard-avoiding frame.

## Theming and styling

`rich-field-theme.ts` maps the native theme (colours, cloze palettes, dynamic type scale) to CSS variables that `rich-field.css` consumes. KaTeX styles come from the `katex` package; its web fonts are not bundled, so formulas fall back to system fonts.

## Build notes

- `@expo/dom-webview` ships with Expo 57 and is already in the iOS Podfile; DOM components need `react-native-web` and `react-dom` as dependencies and a Metro config that leaves `react-native` unpinned for the web platform (`metro.config.js`).
- `@deephaus/rich-text` is consumed from its `dist` build; run `pnpm --filter @deephaus/rich-text build` after changing it (EAS does this in `eas-build-post-install`).

## Checks

- Maestro flows keep working: fields carry `testID="card-field-front|back"` on the native frame and the "Add image to …" buttons remain in the label row.
- `pnpm --filter @deephaus/mobile test`, `pnpm --filter @deephaus/rich-text test`, and `tsc --noEmit` in `apps/mobile`.
- Simulator pass (iPhone Air, iOS 27): typing with autocorrect, bold with a preserved selection, cloze from a collapsed cursor, C2 switch and hint prompt, LaTeX insert and edit, image upload inserted at the cursor, caret scrolling above the keyboard, dark mode.

## Formulas outside the editor

Native card text (previews, study, list rows) renders `$…$` and `$$…$$` with `lib/math-svg.ts`: MathJax (`mathjax-full`, pure JS, loaded on first use) turns TeX into SVG, and `components/math-formula.tsx` draws it with `react-native-svg` in the current text colour. Inline formulas sit inside the native `Text` shifted down by their depth, and `ClozeText` pads its bottom by that depth because text views clip inline views to their bounds. The patterns match `@deephaus/rich-text`'s markdown parser.

## Known limits

- After a native modal (hint, formula, pickers) the keyboard does not come back on its own; tap the field again.
- VoiceOver inside the web view has not been re-audited; see `native-editor-accessibility.md`.
- The native placeholder renders cloze chips, bold and formulas like the card preview; other markup (lists, inline code) shows as markdown for the moment before the editor takes over.
