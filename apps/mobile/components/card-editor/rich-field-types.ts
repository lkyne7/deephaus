/** The cloze deletion the cursor is in, if any. */
export type RichFieldCloze = { id: string; hint: string | null };

/** Caret box relative to the top of the field's web view, in CSS pixels (points). */
export type RichFieldCaret = { top: number; bottom: number };

/** Formatting under the cursor, reported by the editor after every change. */
export type RichFieldState = {
  focused: boolean;
  empty: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  bulletList: boolean;
  orderedList: boolean;
  cloze: RichFieldCloze | null;
  canUndo: boolean;
  canRedo: boolean;
  caret: RichFieldCaret | null;
};

export const EMPTY_RICH_FIELD_STATE: RichFieldState = {
  focused: false,
  empty: true,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  bulletList: false,
  orderedList: false,
  cloze: null,
  canUndo: false,
  canRedo: false,
  caret: null,
};

/** A tap on an existing LaTeX node; `pos` identifies the node for `setLatexFormula`. */
export type RichFieldLatexTap = { pos: number; formula: string; display: boolean };

export type RichFieldClozePalette = { bg: string; fg: string; border: string };

/** Colours and type scale the web view mirrors from the native theme. */
export type RichFieldTheme = {
  scheme: "light" | "dark";
  fontScale: number;
  text: string;
  placeholder: string;
  muted: string;
  link: string;
  border: string;
  codeBg: string;
  surface: string;
  selection: string;
  cloze: RichFieldClozePalette[];
};

/**
 * Commands the native toolbar sends into the editor. Arguments must be JSON
 * values: the call is serialised into the web view. (Not declared as a
 * DOMImperativeFactory: its index signature would widen every argument.)
 */
export interface RichFieldHandle {
  focus(): void;
  blur(): void;
  toggleBold(): void;
  toggleItalic(): void;
  toggleUnderline(): void;
  toggleStrike(): void;
  toggleCode(): void;
  toggleBulletList(): void;
  toggleOrderedList(): void;
  /** Wrap the selection (or the word at the cursor) in a new cloze deletion. */
  addCloze(): void;
  setClozeId(id: string): void;
  setClozeHint(hint: string | null): void;
  removeCloze(): void;
  insertLatex(formula: string, display: boolean): void;
  setLatexFormula(pos: number, formula: string): void;
  insertImage(src: string, alt: string): void;
  insertAudio(src: string, title: string): void;
  undo(): void;
  redo(): void;
}
