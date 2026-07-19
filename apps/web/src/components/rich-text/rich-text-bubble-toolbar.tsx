"use client";

import {
  applyLinkMark,
  applyTextColor,
  CLOZE_IDS,
  RICH_TEXT_REQUEST_LINK_EVENT,
  TEXT_COLORS,
  unsetLinkMark,
} from "@deephaus/rich-text";
import { BubbleMenu, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatShortcut, useModKeyLabel } from "@/lib/keyboard-shortcuts";
import "./rich-text-bubble.css";

type HeadingLevel = 1 | 2 | 3;

type DocChain = {
  focus: () => DocChain;
  run: () => boolean;
  toggleBold: () => DocChain;
  toggleItalic: () => DocChain;
  toggleUnderline: () => DocChain;
  toggleStrike: () => DocChain;
  toggleSuperscript: () => DocChain;
  toggleSubscript: () => DocChain;
  toggleCode: () => DocChain;
  toggleBulletList: () => DocChain;
  toggleOrderedList: () => DocChain;
  toggleBlockquote: () => DocChain;
  toggleHeading: (attrs: { level: number }) => DocChain;
  setParagraph: () => DocChain;
  extendMarkRange: (name: string) => DocChain;
  setTextSelection: (range: { from: number; to: number }) => DocChain;
  insertLatexInline: (formula?: string) => DocChain;
  insertLatexBlock: (formula?: string) => DocChain;
  addClozeNew: () => DocChain;
  addClozeSame: () => DocChain;
  setImage: (attrs: { src: string; alt?: string }) => DocChain;
};

function chain(editor: Editor): DocChain {
  return editor.chain().focus() as unknown as DocChain;
}

const BUBBLE_TIPPY_OPTIONS = {
  duration: 120,
  placement: "top" as const,
  offset: [0, 8] as [number, number],
  maxWidth: "none" as const,
  appendTo: () => document.body,
  interactive: true,
  popperOptions: {
    modifiers: [
      {
        name: "preventOverflow",
        options: { padding: 12, altAxis: true },
      },
      {
        // Flip below the selection when there isn't room above (e.g. near the
        // top of the viewport) so the toolbar never gets cut off.
        name: "flip",
        options: { fallbackPlacements: ["bottom"], padding: 12 },
      },
    ],
  },
};

type LinkDraft = { from: number; to: number; url: string };

type TippyRootElement = HTMLElement & {
  _tippy?: {
    popperInstance?: { update: () => Promise<unknown> } | null;
  };
};

/**
 * Invisible marker that repositions the bubble whenever its content resizes.
 * Popper only measures on show, so when the toolbar grows while open (e.g. the
 * cloze section appears after creating a cloze near the top of the window) it
 * would otherwise extend past the viewport edge. A ResizeObserver forces a
 * popper update, which re-runs the flip + overflow-clamping modifiers.
 */
function BubbleAutoReposition() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    const bubble = marker.closest(".dh-rt-bubble");
    if (!bubble) return;
    const observer = new ResizeObserver(() => {
      const root = marker.closest("[data-tippy-root]") as TippyRootElement | null;
      void root?._tippy?.popperInstance?.update();
    });
    observer.observe(bubble);
    return () => observer.disconnect();
  }, []);

  return <span ref={ref} hidden aria-hidden />;
}

export type RichTextBubbleToolbarProps = {
  editor: Editor;
  /** Marks the document dirty (source autosave). */
  onEdit?: () => void;
  /** When set, shows Generate-from-selection (source/create only). */
  onGenerateFromSelection?: (text: string) => void;
  generateFromSelectionDisabled?: boolean;
  headingLevels?: readonly HeadingLevel[];
  showCode?: boolean;
  showBlockquote?: boolean;
  clozeEnabled?: boolean;
  /** Opens a file picker / inserts an image into the editor. */
  onInsertImage?: () => void;
  menuPluginKey?: string;
  disabled?: boolean;
};

function ToolButton({
  icon,
  glyph,
  glyphNode,
  label,
  shortcut,
  onClick,
  active = false,
  disabled = false,
  onEdit,
}: {
  icon?: string;
  /** Text glyph shown in the button instead of a remix icon (e.g. {N}). */
  glyph?: string;
  /** Custom node glyph (e.g. Anki-style cloze SVG). */
  glyphNode?: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  onEdit?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const aria = shortcut ? `${label} (${shortcut})` : label;
  const usesGlyph = Boolean(glyph || glyphNode);

  useLayoutEffect(() => {
    if (!hover || !btnRef.current) {
      setCoords(null);
      return;
    }
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.top - 6,
        left: rect.left + rect.width / 2,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hover]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`dh-rt-btn${usesGlyph ? " dh-rt-btn--glyph" : ""}${active ? " is-active" : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          onEdit?.();
        }}
        onClick={onClick}
        disabled={disabled}
        aria-label={aria}
        onMouseEnter={() => {
          if (!disabled) setHover(true);
        }}
        onMouseLeave={() => setHover(false)}
        onFocus={() => {
          if (!disabled) setHover(true);
        }}
        onBlur={() => setHover(false)}
      >
        {glyphNode ? (
          glyphNode
        ) : glyph ? (
          <span className="dh-rt-btn__glyph" aria-hidden>
            {glyph}
          </span>
        ) : (
          <i className={icon} aria-hidden />
        )}
      </button>
      {hover && coords
        ? createPortal(
            <span
              className="dh-rt-btn-hover-label is-visible"
              role="tooltip"
              style={{ top: coords.top, left: coords.left }}
            >
              <span>{label}</span>
              {shortcut ? <span className="dh-rt-btn-hover-shortcut">{shortcut}</span> : null}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/** Anki-style cloze glyph: [+] for new, […] for same. */
function AnkiClozeIcon({ withPlus = false }: { withPlus?: boolean }) {
  return (
    <svg
      className="dh-rt-btn__anki-cloze"
      viewBox="0 0 18 16"
      width="18"
      height="14"
      aria-hidden
      focusable="false"
    >
      {/* Left square bracket */}
      <path
        fill="currentColor"
        d="M5 1.25H2.35c-.75 0-1.35.6-1.35 1.35v10.8c0 .75.6 1.35 1.35 1.35H5V13.2H2.75V3.8H5V1.25z"
      />
      {/* Right square bracket */}
      <path
        fill="currentColor"
        d="M13 1.25h2.65c.75 0 1.35.6 1.35 1.35v10.8c0 .75-.6 1.35-1.35 1.35H13V13.2h2.25V3.8H13V1.25z"
      />
      {withPlus ? (
        <path
          fill="currentColor"
          d="M8.25 4.6h1.5v2.65h2.65v1.5H9.75v2.65h-1.5V8.75H5.6v-1.5h2.65z"
        />
      ) : (
        <>
          <circle cx="6.9" cy="8" r="1.15" fill="currentColor" />
          <circle cx="9" cy="8" r="1.15" fill="currentColor" />
          <circle cx="11.1" cy="8" r="1.15" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function editorShortcut(
  mod: string,
  key: string,
  opts?: { shift?: boolean; alt?: boolean },
): string {
  const parts = [mod];
  if (opts?.alt) parts.push("⌥");
  if (opts?.shift) parts.push("⇧");
  parts.push(key.toUpperCase());
  return parts.join("");
}

type ActiveCloze = { id: string; hint: string };

/**
 * Deterministic cloze detection. `editor.isActive("cloze")` is unreliable at
 * mark boundaries and for partial selections, so:
 * - collapsed cursor: cloze mark at the caret (stored marks first)
 * - range: every text node in the selection must carry the same cloze id
 */
function getActiveCloze(editor: Editor): ActiveCloze | null {
  const { state } = editor;
  const type = state.schema.marks.cloze;
  if (!type) return null;

  const read = (mark: { attrs: Record<string, unknown> }): ActiveCloze => ({
    id: String(mark.attrs.id ?? "c1"),
    hint: typeof mark.attrs.hint === "string" ? mark.attrs.hint : "",
  });

  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    const mark = marks.find((m) => m.type === type);
    return mark ? read(mark) : null;
  }

  let found: ActiveCloze | null = null;
  let uniform = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!uniform || !node.isText) return;
    const mark = node.marks.find((m) => m.type === type);
    if (!mark) {
      uniform = false;
      return;
    }
    const next = read(mark);
    if (found && found.id !== next.id) {
      uniform = false;
      return;
    }
    found = next;
  });
  return uniform ? found : null;
}

/**
 * Hover/click submenu panel. Positioned off the anchor with a transparent
 * padding bridge (so hover survives the gap) and flips to the other side
 * when it would render past the viewport edge.
 */
function Flyout({
  direction,
  children,
}: {
  direction: "side" | "down";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (direction === "side" && rect.right > window.innerWidth - 8) setFlipped(true);
    if (direction === "down" && rect.bottom > window.innerHeight - 8) setFlipped(true);
  }, [direction]);

  return (
    <div
      ref={ref}
      className={`dh-rt-flyout dh-rt-flyout--${direction}${flipped ? " is-flipped" : ""}`}
    >
      <div className="dh-rt-flyout__panel">{children}</div>
    </div>
  );
}

/** Shared floating formatting toolbar for source, notes, and card fields. */
export function RichTextBubbleToolbar({
  editor,
  onEdit,
  onGenerateFromSelection,
  generateFromSelectionDisabled = false,
  headingLevels = [1, 2, 3],
  showCode = false,
  showBlockquote = true,
  clozeEnabled = false,
  onInsertImage,
  menuPluginKey = "richTextBubble",
  disabled = false,
}: RichTextBubbleToolbarProps) {
  const mod = useModKeyLabel();
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const linkDraftRef = useRef<LinkDraft | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  linkDraftRef.current = linkDraft;

  const markEdit = useCallback(() => {
    onEdit?.();
  }, [onEdit]);

  const openLinkDraft = useCallback(
    (from?: number, to?: number) => {
      if (disabled) return;
      const sel = editor.state.selection;
      const rangeFrom = from ?? sel.from;
      const rangeTo = to ?? sel.to;
      if (rangeFrom >= rangeTo) return;
      const existing = editor.getAttributes("link").href;
      setLinkDraft({
        from: rangeFrom,
        to: rangeTo,
        url: typeof existing === "string" ? existing : "",
      });
    },
    [editor, disabled],
  );

  useEffect(() => {
    const dom = editor.view.dom;
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ from: number; to: number }>).detail;
      openLinkDraft(detail?.from, detail?.to);
    };
    dom.addEventListener(RICH_TEXT_REQUEST_LINK_EVENT, onRequest);
    return () => dom.removeEventListener(RICH_TEXT_REQUEST_LINK_EVENT, onRequest);
  }, [editor, openLinkDraft]);

  const linkDraftKey = linkDraft ? `${linkDraft.from}:${linkDraft.to}` : null;
  useEffect(() => {
    if (!linkDraftKey) return;
    const id = window.requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [linkDraftKey]);

  const closeLinkDraft = useCallback(
    (restoreSelection: boolean) => {
      const draft = linkDraftRef.current;
      setLinkDraft(null);
      if (restoreSelection && draft) {
        chain(editor).setTextSelection({ from: draft.from, to: draft.to }).run();
      }
    },
    [editor],
  );

  const applyLinkDraft = useCallback(() => {
    const draft = linkDraftRef.current;
    if (!draft) return;
    markEdit();
    if (applyLinkMark(editor, draft.url, { from: draft.from, to: draft.to })) {
      setLinkDraft(null);
    }
  }, [editor, markEdit]);

  const toggleLink = () => {
    if (linkDraft) {
      closeLinkDraft(true);
      return;
    }
    if (editor.isActive("link")) {
      markEdit();
      unsetLinkMark(editor);
      return;
    }
    openLinkDraft();
  };

  const handleGenerate = () => {
    if (!onGenerateFromSelection || generateFromSelectionDisabled) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "\n").trim();
    if (selected.length < 20) {
      window.alert("Select at least 20 characters to generate flashcards.");
      return;
    }
    onGenerateFromSelection(selected);
  };

  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [clozeHintDraft, setClozeHintDraft] = useState("");
  const [, setTick] = useState(0);
  const styleCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openStyleMenu = useCallback(() => {
    if (styleCloseTimer.current) clearTimeout(styleCloseTimer.current);
    setColorMenuOpen(false);
    setStyleMenuOpen(true);
  }, []);
  const scheduleStyleClose = useCallback(() => {
    if (styleCloseTimer.current) clearTimeout(styleCloseTimer.current);
    styleCloseTimer.current = setTimeout(() => setStyleMenuOpen(false), 150);
  }, []);

  useEffect(() => {
    const onSelection = () => {
      setStyleMenuOpen(false);
      setColorMenuOpen(false);
    };
    const onChange = () => {
      // Re-render immediately so the cloze section, active states, and colors
      // track the selection without waiting on parent renders.
      setTick((n) => n + 1);
      const cloze = getActiveCloze(editor);
      if (cloze) setClozeHintDraft(cloze.hint);
    };
    editor.on("selectionUpdate", onSelection);
    editor.on("selectionUpdate", onChange);
    editor.on("transaction", onChange);
    onChange();
    return () => {
      editor.off("selectionUpdate", onSelection);
      editor.off("selectionUpdate", onChange);
      editor.off("transaction", onChange);
    };
  }, [editor]);

  const commitClozeHint = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      markEdit();
      editor.chain().focus().extendMarkRange("cloze").run();
      editor.commands.updateCloze({ hint: trimmed || null });
    },
    [editor, markEdit],
  );

  const blockStyles = useMemo(() => {
    const clearBlock = () => {
      const c = chain(editor);
      if (editor.isActive("bulletList")) c.toggleBulletList();
      if (editor.isActive("orderedList")) c.toggleOrderedList();
      if (editor.isActive("blockquote")) c.toggleBlockquote();
      c.setParagraph().run();
    };
    const styles: Array<{
      key: string;
      label: string;
      icon: string;
      isActive: () => boolean;
      apply: () => void;
    }> = [
      {
        key: "paragraph",
        label: "Normal text",
        icon: "ri-text",
        isActive: () =>
          !editor.isActive("heading") &&
          !editor.isActive("bulletList") &&
          !editor.isActive("orderedList") &&
          !editor.isActive("blockquote"),
        apply: clearBlock,
      },
      ...headingLevels.map((level) => ({
        key: `h${level}`,
        label: `Heading ${level}`,
        icon: `ri-h-${level}`,
        isActive: () => editor.isActive("heading", { level }),
        apply: () => chain(editor).toggleHeading({ level }).run(),
      })),
      {
        key: "bulletList",
        label: "Bulleted list",
        icon: "ri-list-unordered",
        isActive: () => editor.isActive("bulletList"),
        apply: () => chain(editor).toggleBulletList().run(),
      },
      {
        key: "orderedList",
        label: "Numbered list",
        icon: "ri-list-ordered",
        isActive: () => editor.isActive("orderedList"),
        apply: () => chain(editor).toggleOrderedList().run(),
      },
    ];
    if (showBlockquote) {
      styles.push({
        key: "blockquote",
        label: "Quote",
        icon: "ri-double-quotes-l",
        isActive: () => editor.isActive("blockquote"),
        apply: () => chain(editor).toggleBlockquote().run(),
      });
    }
    return styles;
  }, [editor, headingLevels, showBlockquote]);

  const currentStyle = blockStyles.find((s) => s.key !== "paragraph" && s.isActive()) ?? blockStyles[0];
  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) || null;
  const activeCloze = clozeEnabled ? getActiveCloze(editor) : null;

  const tippyOptions = useMemo(
    () => ({
      ...BUBBLE_TIPPY_OPTIONS,
      onHide: () => {
        if (linkDraftRef.current) return false;
      },
    }),
    [],
  );

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={menuPluginKey}
      updateDelay={0}
      tippyOptions={tippyOptions}
      className="dh-rt-bubble dh-rt-bubble--stack"
      shouldShow={({ editor: ed, view, state }) => {
        if (linkDraftRef.current) return true;
        if (disabled) return false;
        const { from, to, empty } = state.selection;
        if (ed.isActive("image")) return false;
        if (!ed.isEditable) return false;
        // Only the focused editor shows its toolbar. Focus inside the bubble
        // itself (hint input, flyouts) is handled by the BubbleMenu plugin's
        // blur logic, which keeps the menu open when focus moves into it.
        if (!view.hasFocus() && !ed.isFocused) return false;
        if (ed.isActive("latexInline") || ed.isActive("latexBlock")) return true;
        // Clicking into a cloze opens the toolbar with the cloze section.
        if (getActiveCloze(ed) != null) return true;
        if (empty || from === to) return false;
        return true;
      }}
    >
      <BubbleAutoReposition />
      {linkDraft ? (
        <form
          className="dh-rt-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            applyLinkDraft();
          }}
          onMouseDown={(e) => {
            if (e.target !== linkInputRef.current) e.preventDefault();
          }}
        >
          <i className="ri-link dh-rt-link-form-icon" aria-hidden />
          <input
            ref={linkInputRef}
            type="text"
            inputMode="url"
            autoComplete="url"
            className="dh-rt-link-input"
            placeholder="https://example.com"
            value={linkDraft.url}
            onChange={(e) =>
              setLinkDraft((prev) => (prev ? { ...prev, url: e.target.value } : prev))
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeLinkDraft(true);
              }
            }}
            aria-label="Link URL"
          />
          <button
            type="submit"
            className="dh-rt-btn is-active"
            aria-label="Apply link"
            disabled={!linkDraft.url.trim()}
          >
            <i className="ri-check-line" aria-hidden />
          </button>
          <button
            type="button"
            className="dh-rt-btn"
            aria-label="Cancel"
            onClick={() => closeLinkDraft(true)}
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </form>
      ) : (
        <>
          <div
            className="dh-rt-anchor"
            onMouseEnter={openStyleMenu}
            onMouseLeave={scheduleStyleClose}
          >
            <button
              type="button"
              className="dh-rt-style-btn"
              aria-expanded={styleMenuOpen}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setColorMenuOpen(false);
                setStyleMenuOpen((open) => !open);
              }}
            >
              <span className="dh-rt-style-btn__label">
                <i className={currentStyle.icon} aria-hidden />
                {currentStyle.label}
              </span>
              <i className="ri-arrow-right-s-line" aria-hidden />
            </button>
            {styleMenuOpen ? (
              <Flyout direction="side">
                {blockStyles.map((style) => (
                  <button
                    key={style.key}
                    type="button"
                    role="menuitem"
                    className={`dh-rt-style-item${style.isActive() ? " is-active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      markEdit();
                    }}
                    onClick={() => {
                      style.apply();
                      setStyleMenuOpen(false);
                    }}
                  >
                    <i className={style.icon} aria-hidden />
                    <span>{style.label}</span>
                    {style.isActive() ? (
                      <i className="ri-check-line dh-rt-style-item__check" aria-hidden />
                    ) : null}
                  </button>
                ))}
              </Flyout>
            ) : null}
          </div>
          <div className="dh-rt-rule" />
          <div className="dh-rt-row">
            <ToolButton
              icon="ri-bold"
              label="Bold"
              shortcut={formatShortcut(mod, "B")}
              active={editor.isActive("bold")}
              onEdit={markEdit}
              onClick={() => chain(editor).toggleBold().run()}
            />
            <ToolButton
              icon="ri-italic"
              label="Italic"
              shortcut={formatShortcut(mod, "I")}
              active={editor.isActive("italic")}
              onEdit={markEdit}
              onClick={() => chain(editor).toggleItalic().run()}
            />
            <ToolButton
              icon="ri-underline"
              label="Underline"
              shortcut={formatShortcut(mod, "U")}
              active={editor.isActive("underline")}
              onEdit={markEdit}
              onClick={() => chain(editor).toggleUnderline().run()}
            />
            <ToolButton
              icon="ri-strikethrough"
              label="Strikethrough"
              shortcut={editorShortcut(mod, "S", { shift: true })}
              active={editor.isActive("strike")}
              onEdit={markEdit}
              onClick={() => chain(editor).toggleStrike().run()}
            />
            {showCode ? (
              <ToolButton
                icon="ri-code-s-slash-line"
                label="Inline code"
                shortcut={formatShortcut(mod, "E")}
                active={editor.isActive("code")}
                onEdit={markEdit}
                onClick={() => chain(editor).toggleCode().run()}
              />
            ) : null}
            <ToolButton
              icon="ri-link"
              label="Link"
              shortcut={formatShortcut(mod, "K")}
              active={editor.isActive("link")}
              onClick={toggleLink}
            />
            {onInsertImage ? (
              <ToolButton
                icon="ri-image-add-line"
                label="Insert image"
                disabled={disabled}
                onEdit={markEdit}
                onClick={onInsertImage}
              />
            ) : null}
          </div>
          <div className="dh-rt-row dh-rt-anchor">
            <ToolButton
              icon="ri-superscript"
              label="Superscript"
              shortcut={`${mod}.`}
              active={editor.isActive("superscript")}
              onEdit={markEdit}
              onClick={() => chain(editor).toggleSuperscript().run()}
            />
            <ToolButton
              icon="ri-subscript"
              label="Subscript"
              shortcut={`${mod},`}
              active={editor.isActive("subscript")}
              onEdit={markEdit}
              onClick={() => chain(editor).toggleSubscript().run()}
            />
            <div className="dh-rt-anchor dh-rt-anchor--inline">
              <ToolButton
                glyphNode={
                  <span
                    className="dh-rt-color-glyph"
                    style={currentColor ? { color: currentColor } : undefined}
                    aria-hidden
                  >
                    A
                  </span>
                }
                label="Text color"
                shortcut={editorShortcut(mod, "H", { shift: true })}
                active={Boolean(currentColor) || colorMenuOpen}
                onClick={() => {
                  setStyleMenuOpen(false);
                  setColorMenuOpen((open) => !open);
                }}
              />
              {colorMenuOpen ? (
                <Flyout direction="side">
                  {TEXT_COLORS.map((color) => {
                    const isActive = color.value
                      ? currentColor === color.value
                      : !currentColor;
                    return (
                      <button
                        key={color.key}
                        type="button"
                        role="menuitem"
                        className={`dh-rt-style-item${isActive ? " is-active" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          markEdit();
                        }}
                        onClick={() => {
                          applyTextColor(editor, color.value);
                          setColorMenuOpen(false);
                        }}
                      >
                        <span
                          className="dh-rt-color-swatch"
                          style={color.value ? { color: color.value } : undefined}
                          aria-hidden
                        >
                          A
                        </span>
                        <span>{color.label}</span>
                        {isActive ? (
                          <i className="ri-check-line dh-rt-style-item__check" aria-hidden />
                        ) : null}
                      </button>
                    );
                  })}
                </Flyout>
              ) : null}
            </div>
            <ToolButton
              icon="ri-formula"
              label="Equation"
              shortcut={editorShortcut(mod, "E", { shift: true })}
              active={editor.isActive("latexInline") || editor.isActive("latexBlock")}
              onEdit={markEdit}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const selected = editor.state.doc.textBetween(from, to, " ").trim();
                chain(editor).insertLatexInline(selected || "x").run();
              }}
            />
            {clozeEnabled ? (
              <>
                <ToolButton
                  glyphNode={<AnkiClozeIcon withPlus />}
                  label="New cloze"
                  shortcut={editorShortcut(mod, "C", { shift: true })}
                  active={activeCloze != null}
                  onEdit={markEdit}
                  onClick={() => chain(editor).addClozeNew().run()}
                />
                <ToolButton
                  glyphNode={<AnkiClozeIcon />}
                  label="Same cloze"
                  shortcut={editorShortcut(mod, "C", { shift: true, alt: true })}
                  onEdit={markEdit}
                  onClick={() => chain(editor).addClozeSame().run()}
                />
              </>
            ) : null}
          </div>
          {activeCloze ? (
            <>
              <div className="dh-rt-rule" />
              <div className="dh-rt-row dh-rt-cloze-ids" role="group" aria-label="Cloze number">
                {CLOZE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`dh-rt-cloze-chip dh-cloze dh-cloze--${id}${activeCloze.id === id ? " is-active" : ""}`}
                    aria-pressed={activeCloze.id === id}
                    title={`Set ${id.toUpperCase()}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      markEdit();
                    }}
                    onClick={() => {
                      editor.chain().focus().extendMarkRange("cloze").run();
                      editor.commands.updateCloze({ id });
                    }}
                  >
                    {id.slice(1)}
                  </button>
                ))}
              </div>
              <div className="dh-rt-row">
                <input
                  type="text"
                  className="dh-rt-link-input dh-rt-cloze-hint dh-rt-cloze-hint--fill"
                  value={clozeHintDraft}
                  placeholder="Hint"
                  aria-label="Cloze hint"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => setClozeHintDraft(e.target.value)}
                  onBlur={() => commitClozeHint(clozeHintDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitClozeHint(clozeHintDraft);
                      editor.commands.focus();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      editor.commands.focus();
                    }
                  }}
                />
                <button
                  type="button"
                  className="dh-rt-btn dh-rt-btn--danger"
                  title="Remove deletion"
                  aria-label="Remove deletion"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    markEdit();
                  }}
                  onClick={() =>
                    editor.chain().focus().extendMarkRange("cloze").unsetMark("cloze").run()
                  }
                >
                  <i className="ri-delete-bin-line" aria-hidden />
                </button>
              </div>
            </>
          ) : null}
          {onGenerateFromSelection ? (
            <>
              <div className="dh-rt-rule" />
              <button
                type="button"
                className="dh-rt-generate"
                disabled={generateFromSelectionDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleGenerate}
              >
                <i
                  className={
                    generateFromSelectionDisabled
                      ? "ri-loader-4-line icon-spin"
                      : "ri-sparkling-2-line"
                  }
                  aria-hidden
                />
                <span>{generateFromSelectionDisabled ? "Generating…" : "Generate cards"}</span>
                <span className="dh-rt-generate__shortcut">
                  {editorShortcut(mod, "G", { shift: true })}
                </span>
              </button>
            </>
          ) : null}
        </>
      )}
    </BubbleMenu>
  );
}
