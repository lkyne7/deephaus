"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  DETAIL_LEVEL_OPTIONS,
  FOCUS_PRESET_OPTIONS,
  GENERATION_CARD_TYPE_OPTIONS,
  detailLevelLabel,
  focusPresetOption,
  type DetailLevel,
  type FocusPreset,
  type GenerationCardType,
} from "@deephaus/shared";
import { BrandMark } from "@/components/brand-mark";
import { AnkiLogo, QuizletLogo } from "@/components/brand-logos";
import { DeckMenu } from "@/components/create/deck-menu";
import {
  ComposerSourceDialog,
  type ComposerSourceDialogMode,
} from "@/components/create/composer-source-dialog";
import {
  DOCUMENT_SIZE_HINT,
  PASTE_AS_SOURCE_MIN_CHARS,
  VIDEO_SIZE_HINT,
  attachmentDetail,
  attachmentFromFile,
  attachmentFromUrl,
  attachmentIcon,
  attachmentTitle,
  newAttachmentId,
  type ComposerAttachment,
} from "@/components/create/composer-sources";
import { DOCUMENT_ACCEPT, VIDEO_ACCEPT } from "@/lib/sources/file-types";

/** Generation settings edited from the composer's settings pill. */
export type GenerationControls = {
  detailLevel: DetailLevel;
  onDetailLevelChange: (level: DetailLevel) => void;
  selectedTypes: Set<GenerationCardType>;
  onToggleCardType: (type: GenerationCardType) => void;
  focusPreset: FocusPreset;
  onFocusPresetChange: (preset: FocusPreset) => void;
  clozeHints: boolean;
  onClozeHintsChange: (next: boolean) => void;
  autoTags: boolean;
  onAutoTagsChange: (next: boolean) => void;
};

/** What a text-only message does in a deck that already has cards. */
export type ComposerIntent = "edit" | "generate";

export type CreateComposerHandle = {
  focus: () => void;
  openSourceMenu: () => void;
  addFiles: (files: File[]) => void;
};

type Props = {
  /** `start` is the centered first screen; `docked` sits under the conversation. */
  variant: "start" | "docked";
  text: string;
  onTextChange: (next: string) => void;
  attachments: ComposerAttachment[];
  onAttachmentsChange: (next: ComposerAttachment[]) => void;
  placeholder: string;
  controls: GenerationControls;
  /** Deck picker shown on the start screen. */
  deckPicker?: {
    label: string;
    decks: Array<{ id: string; name: string }>;
    onSelect: (deckId: string) => void;
  };
  /** Generation settings don't apply here, e.g. a message scoped to selected cards. */
  hideSettings?: boolean;
  /** Cards a text-only message is scoped to (a selection or a single card). */
  scope?: { label: string; onClear: () => void } | null;
  /** Edit-vs-generate choice, shown only when both are possible. */
  intent?: {
    value: ComposerIntent;
    /** Menu wording; the pill itself stays short so the row fits. */
    editLabel: string;
    onChange: (next: ComposerIntent) => void;
  } | null;
  canSend: boolean;
  /** Generation or an edit is running: sending waits until it finishes. */
  working?: boolean;
  workingLabel?: string;
  /** Ends the running generation; absent for work that can't be stopped. */
  onStop?: () => void;
  stopping?: boolean;
  /** Where OAuth connect flows (Notion, Drive) should return to. */
  returnTo: string;
  onSend: () => void;
  /** Store the attached sources without generating cards. */
  onAddSourcesOnly?: () => void;
  onImport: (mode: "anki" | "quizlet") => void;
};

const DETAIL_DESCRIPTIONS: Record<DetailLevel, string> = {
  low: "Only the essentials, fewer cards.",
  medium: "Balanced coverage of the material.",
  high: "Comprehensive, covers nearly everything.",
};

const SOURCE_SHORTCUTS: Array<{ id: SourceAction; label: string; icon: string }> = [
  { id: "document", label: "Document", icon: "ri-file-text-line" },
  { id: "website", label: "Website", icon: "ri-global-line" },
  { id: "youtube", label: "YouTube", icon: "ri-youtube-line" },
  { id: "notion", label: "Notion", icon: "ri-notion-line" },
  { id: "drive", label: "Drive", icon: "ri-cloud-line" },
];

type SourceAction = "document" | "video" | ComposerSourceDialogMode;

/** Close a popover on outside click or Escape. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className={`dhc-check${checked ? " dhc-check--on" : ""}`} aria-hidden>
      {checked ? <i className="ri-check-line" /> : null}
    </span>
  );
}

/**
 * Chat-style composer for the Create page. Holds the message, the attached
 * sources, and the generation settings; the parent decides what sending does.
 */
export const CreateComposer = forwardRef<CreateComposerHandle, Props>(function CreateComposer(
  {
    variant,
    text,
    onTextChange,
    attachments,
    onAttachmentsChange,
    placeholder,
    controls,
    deckPicker,
    hideSettings = false,
    scope,
    intent,
    canSend,
    working = false,
    workingLabel,
    onStop,
    stopping = false,
    returnTo,
    onSend,
    onAddSourcesOnly,
    onImport,
  },
  ref,
) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [menu, setMenu] = useState<"sources" | "settings" | "deck" | "intent" | null>(null);
  const [dialogMode, setDialogMode] = useState<ComposerSourceDialogMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const sourcesRef = useDismiss(menu === "sources", closeMenu);
  const settingsRef = useDismiss(menu === "settings", closeMenu);
  const deckRef = useDismiss(menu === "deck", closeMenu);
  const intentRef = useDismiss(menu === "intent", closeMenu);
  const menuPlacement = variant === "start" ? "down" : "up";

  // Ready to type on arrival, but don't pop the keyboard open on touch devices.
  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) inputRef.current?.focus();
  }, []);

  const composerElRef = useRef<HTMLDivElement>(null);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null);

  // Menus hang off the composer; cap them to the room left in the viewport so
  // a tall one scrolls instead of running off screen.
  useLayoutEffect(() => {
    if (!menu || !composerElRef.current) return;
    const rect = composerElRef.current.getBoundingClientRect();
    const room = menuPlacement === "down" ? window.innerHeight - rect.bottom : rect.top;
    setMenuMaxHeight(Math.max(180, room - 24));
  }, [menu, menuPlacement]);

  const addAttachments = useCallback(
    (next: ComposerAttachment[]) => {
      if (next.length === 0) return;
      onAttachmentsChange([...attachmentsRef.current, ...next]);
    },
    [onAttachmentsChange],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted: ComposerAttachment[] = [];
      let firstError: string | null = null;
      for (const file of files) {
        const result = attachmentFromFile(file);
        if ("attachment" in result) accepted.push(result.attachment);
        else firstError ??= result.error;
      }
      setError(firstError);
      addAttachments(accepted);
    },
    [addAttachments],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      openSourceMenu: () => {
        inputRef.current?.focus();
        setMenu("sources");
      },
      addFiles,
    }),
    [addFiles],
  );

  // Grow the textarea with its content up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, variant]);

  function runSourceAction(action: SourceAction) {
    setMenu(null);
    setError(null);
    if (action === "document") documentInputRef.current?.click();
    else if (action === "video") videoInputRef.current?.click();
    else setDialogMode(action);
  }

  function handlePaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
      return;
    }
    const pasted = e.clipboardData.getData("text/plain");
    const link = attachmentFromUrl(pasted);
    if (link) {
      e.preventDefault();
      setError(null);
      addAttachments([link]);
      return;
    }
    if (pasted.trim().length >= PASTE_AS_SOURCE_MIN_CHARS) {
      e.preventDefault();
      setError(null);
      addAttachments([{ id: newAttachmentId(), kind: "text", text: pasted.trim() }]);
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSend && !working) onSend();
  }

  function handleDrop(e: ReactDragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function removeAttachment(id: string) {
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  }

  function toggleExtractImages(id: string) {
    onAttachmentsChange(
      attachments.map((a) =>
        a.id === id && a.kind === "document" ? { ...a, extractImages: !a.extractImages } : a,
      ),
    );
  }

  const typeLabels = GENERATION_CARD_TYPE_OPTIONS.filter((o) =>
    controls.selectedTypes.has(o.value),
  ).map((o) => (o.value === "cloze" ? "Blanks" : o.label));
  const detailLabel = detailLevelLabel(controls.detailLevel);
  const focusLabel = focusPresetOption(controls.focusPreset).label;
  const settingsSummary = [detailLabel, typeLabels.join(" + ") || "No type", focusLabel].join(" · ");
  const clozeSelected = controls.selectedTypes.has("cloze");

  const sourceMenu = (
    <div
      role="menu"
      aria-label="Add a source"
      className={`dhc-menu dhc-menu--${menuPlacement} dhc-menu--left`}
      style={{ width: 336 }}
    >
      <MenuItem
        icon="ri-file-text-line"
        label="Upload a document"
        hint="PDF, Word, PPT, Excel"
        onClick={() => runSourceAction("document")}
      />
      <MenuItem icon="ri-align-left" label="Paste text or notes" onClick={() => runSourceAction("text")} />
      <MenuItem icon="ri-global-line" label="Website link" onClick={() => runSourceAction("website")} />
      <MenuItem icon="ri-youtube-line" label="YouTube link" onClick={() => runSourceAction("youtube")} />
      <MenuItem
        icon="ri-video-line"
        label="Upload a video"
        hint="MP4, WebM, MOV"
        onClick={() => runSourceAction("video")}
      />
      <MenuItem icon="ri-notion-line" label="Notion page" onClick={() => runSourceAction("notion")} />
      <MenuItem icon="ri-cloud-line" label="Google Drive file" onClick={() => runSourceAction("drive")} />
      <div className="dhc-menu__sep" />
      <MenuItem
        leading={<AnkiLogo size={16} />}
        label="Import an Anki deck"
        onClick={() => {
          setMenu(null);
          onImport("anki");
        }}
      />
      <MenuItem
        leading={<QuizletLogo size={16} />}
        label="Import a Quizlet set"
        onClick={() => {
          setMenu(null);
          onImport("quizlet");
        }}
      />
    </div>
  );

  const settingsMenu = (
    <div
      role="dialog"
      aria-label="Card generation settings"
      className={`dhc-menu dhc-menu--${menuPlacement} dhc-menu--left dhc-settings`}
      style={{ width: 320 }}
    >
      <div className="dhc-settings__label">Detail</div>
      <div className="dhc-seg" role="radiogroup" aria-label="Detail level">
        {DETAIL_LEVEL_OPTIONS.map((option) => {
          const selected = controls.detailLevel === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`dhc-seg__btn${selected ? " is-active" : ""}`}
              onClick={() => controls.onDetailLevelChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="dhc-settings__desc">{DETAIL_DESCRIPTIONS[controls.detailLevel]}</div>

      <div className="dhc-settings__label">Card types</div>
      <div className="dhc-chips" role="group" aria-label="Card types">
        {GENERATION_CARD_TYPE_OPTIONS.map((option) => {
          const selected = controls.selectedTypes.has(option.value);
          const lastOne = selected && controls.selectedTypes.size === 1;
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-disabled={lastOne}
              className={`dhc-chip${selected ? " is-active" : ""}`}
              title={lastOne ? "Keep at least one card type" : option.description}
              onClick={() => {
                if (!lastOne) controls.onToggleCardType(option.value);
              }}
            >
              <i className={selected ? "ri-check-line" : option.icon} aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="dhc-settings__label">Focus</div>
      <div className="dhc-chips" role="radiogroup" aria-label="Focus preset">
        {FOCUS_PRESET_OPTIONS.map((option) => {
          const selected = controls.focusPreset === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`dhc-chip${selected ? " is-active" : ""}`}
              onClick={() => controls.onFocusPresetChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="dhc-settings__desc">{focusPresetOption(controls.focusPreset).description}</div>

      <div className="dhc-settings__label">Options</div>
      <ToggleItem
        icon="ri-price-tag-3-line"
        label="Auto tags"
        title="Tag new cards by topic and source."
        checked={controls.autoTags}
        onChange={controls.onAutoTagsChange}
      />
      <ToggleItem
        icon="ri-lightbulb-line"
        label="Hints on blanks"
        title={
          clozeSelected
            ? "Add hints to fill-in-the-blank cards."
            : "Turn on Fill-in-the-Blank cards to use hints."
        }
        checked={clozeSelected && controls.clozeHints}
        disabled={!clozeSelected}
        onChange={controls.onClozeHintsChange}
      />
    </div>
  );

  return (
    <div className="dhc-composer-wrap">
      <div
        ref={composerElRef}
        className={`dhc-composer dhc-composer--${variant}${dragging ? " dhc-composer--drop" : ""}`}
        style={
          menuMaxHeight ? ({ "--dhc-menu-max": `${menuMaxHeight}px` } as CSSProperties) : undefined
        }
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={documentInputRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          multiple
          hidden
          tabIndex={-1}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept={VIDEO_ACCEPT}
          hidden
          tabIndex={-1}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        {attachments.length > 0 || scope ? (
          <div className="dhc-atts">
            {scope ? (
              <span className="dhc-scope">
                <i className="ri-checkbox-multiple-line" aria-hidden />
                <span className="dhc-scope__label">{scope.label}</span>
                <button
                  type="button"
                  className="dhc-att__remove"
                  onClick={scope.onClear}
                  aria-label="Clear card selection"
                >
                  <i className="ri-close-line" aria-hidden />
                </button>
              </span>
            ) : null}
            {attachments.map((attachment) => (
              <div key={attachment.id} className="dhc-att">
                <span className="dhc-att__icon">
                  <i className={attachmentIcon(attachment)} aria-hidden />
                </span>
                <span className="dhc-att__text">
                  <span className="dhc-att__title" title={attachmentTitle(attachment)}>
                    {attachmentTitle(attachment)}
                  </span>
                  <span className="dhc-att__detail">
                    {attachmentDetail(attachment)}
                    {attachment.kind === "document" ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="dhc-att__toggle"
                          aria-pressed={attachment.extractImages}
                          title="Extract figures and diagrams into the notes, in place"
                          onClick={() => toggleExtractImages(attachment.id)}
                        >
                          images {attachment.extractImages ? "on" : "off"}
                        </button>
                      </>
                    ) : null}
                  </span>
                </span>
                <button
                  type="button"
                  className="dhc-att__remove"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachmentTitle(attachment)}`}
                >
                  <i className="ri-close-line" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="dhc-composer__input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => {
            setError(null);
            onTextChange(e.target.value);
          }}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
        />

        <div className="dhc-composer__row">
          <div ref={sourcesRef} className="dhc-menu-root">
            <button
              type="button"
              className={`dhc-tool dhc-tool--icon${menu === "sources" ? " is-open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={menu === "sources"}
              aria-label="Add a source"
              title="Add a source"
              onClick={() => setMenu((current) => (current === "sources" ? null : "sources"))}
            >
              <i className="ri-add-line" aria-hidden />
            </button>
            {menu === "sources" ? sourceMenu : null}
          </div>

          {hideSettings ? null : (
            <div ref={settingsRef} className="dhc-menu-root dhc-menu-root--shrink">
              <button
                type="button"
                className={`dhc-tool dhc-tool--settings${menu === "settings" ? " is-open" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={menu === "settings"}
                aria-label={`Card settings: ${settingsSummary}`}
                title={`Card settings: ${settingsSummary}`}
                onClick={() => setMenu((current) => (current === "settings" ? null : "settings"))}
              >
                <i className="ri-equalizer-2-line dhc-tool__icon" aria-hidden />
                <span className="dhc-tool__label dhc-tool__label--full">{settingsSummary}</span>
                <span className="dhc-tool__label dhc-tool__label--short">
                  {detailLabel} · {focusLabel}
                </span>
                <i className="ri-arrow-down-s-line dhc-tool__caret" aria-hidden />
              </button>
              {menu === "settings" ? settingsMenu : null}
            </div>
          )}

          <span className="dhc-composer__spacer" />

          {intent ? (
            <div ref={intentRef} className="dhc-menu-root">
              <button
                type="button"
                className={`dhc-tool dhc-tool--ghost${menu === "intent" ? " is-open" : ""}`}
                aria-haspopup="menu"
                aria-expanded={menu === "intent"}
                title="What this message does"
                onClick={() => setMenu((current) => (current === "intent" ? null : "intent"))}
              >
                <i
                  className={`${intent.value === "edit" ? "ri-edit-2-line" : "ri-sparkling-2-line"} dhc-tool__icon`}
                  aria-hidden
                />
                <span className="dhc-tool__label">
                  {intent.value === "edit" ? "Edit cards" : "New cards"}
                </span>
                <i className="ri-arrow-down-s-line dhc-tool__caret" aria-hidden />
              </button>
              {menu === "intent" ? (
                <div
                  role="menu"
                  aria-label="What this message does"
                  className={`dhc-menu dhc-menu--${menuPlacement} dhc-menu--right`}
                  style={{ width: 300 }}
                >
                  <MenuItem
                    icon="ri-edit-2-line"
                    label={intent.editLabel}
                    description="Change existing cards with your instruction."
                    active={intent.value === "edit"}
                    onClick={() => {
                      intent.onChange("edit");
                      setMenu(null);
                    }}
                  />
                  <MenuItem
                    icon="ri-sparkling-2-line"
                    label="Generate new cards"
                    description="Add cards to this deck, guided by your instruction."
                    active={intent.value === "generate"}
                    onClick={() => {
                      intent.onChange("generate");
                      setMenu(null);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {deckPicker ? (
            <div ref={deckRef} className="dhc-menu-root dhc-menu-root--shrink">
              <button
                type="button"
                className={`dhc-tool dhc-tool--ghost${menu === "deck" ? " is-open" : ""}`}
                aria-haspopup="menu"
                aria-expanded={menu === "deck"}
                title="Choose a deck"
                onClick={() => setMenu((current) => (current === "deck" ? null : "deck"))}
              >
                <i className="ri-folder-3-line dhc-tool__icon" aria-hidden />
                <span className="dhc-tool__label">{deckPicker.label}</span>
                <i className="ri-arrow-down-s-line dhc-tool__caret" aria-hidden />
              </button>
              {menu === "deck" ? (
                <DeckMenu
                  decks={deckPicker.decks}
                  currentId={null}
                  placement={menuPlacement}
                  align="right"
                  onNew={() => setMenu(null)}
                  onSelect={(deckId) => {
                    setMenu(null);
                    deckPicker.onSelect(deckId);
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {working && onStop ? (
            <button
              type="button"
              className="dhc-send"
              disabled={stopping}
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating and keep the cards so far"
            >
              <i className="ri-stop-fill" aria-hidden />
            </button>
          ) : working ? (
            <span className="dhc-working" role="status" title={workingLabel ?? "Working…"}>
              <BrandMark size={32} animated title={workingLabel ?? "Working"} />
            </span>
          ) : (
            <button
              type="button"
              className="dhc-send"
              disabled={!canSend}
              onClick={() => {
                onSend();
                // This button is about to be swapped out; keep the cursor in the message box.
                inputRef.current?.focus();
              }}
              aria-label="Send"
              title="Send (Enter)"
            >
              <i className="ri-arrow-up-line" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="notice notice-error dhc-notice" role="alert">
          <i className="ri-error-warning-line" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {attachments.length > 0 && onAddSourcesOnly && !working ? (
        <div className="dhc-composer__aside">
          <span>
            Sending generates cards from {attachments.length === 1 ? "this source" : "these sources"}.
          </span>
          <button type="button" className="dhc-link" onClick={onAddSourcesOnly}>
            Add without generating
          </button>
        </div>
      ) : null}

      {variant === "start" && attachments.length === 0 ? (
        <div className="dhc-shortcuts">
          {SOURCE_SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              className="dhc-shortcut"
              title={
                shortcut.id === "document"
                  ? DOCUMENT_SIZE_HINT
                  : shortcut.id === "video"
                    ? VIDEO_SIZE_HINT
                    : undefined
              }
              onClick={() => runSourceAction(shortcut.id)}
            >
              <i className={shortcut.icon} aria-hidden />
              {shortcut.label}
            </button>
          ))}
          <button type="button" className="dhc-shortcut" onClick={() => onImport("anki")}>
            <AnkiLogo size={14} />
            <QuizletLogo size={14} />
            Import Anki or Quizlet
          </button>
        </div>
      ) : null}

      <ComposerSourceDialog
        mode={dialogMode}
        returnTo={returnTo}
        onClose={() => setDialogMode(null)}
        onAttach={(attachment) => {
          addAttachments([attachment]);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
});

function MenuItem({
  icon,
  leading,
  label,
  hint,
  description,
  active,
  onClick,
}: {
  icon?: string;
  leading?: ReactNode;
  label: string;
  hint?: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`dh-menu-item${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {leading ? (
        <span className="dhc-menu__leading">{leading}</span>
      ) : icon ? (
        <i className={`${icon} dh-menu-item__icon`} aria-hidden />
      ) : null}
      <span className="dhc-menu__text">
        <span className="dh-menu-item__label">{label}</span>
        {description ? <span className="dhc-menu__desc">{description}</span> : null}
      </span>
      {hint ? <span className="dhc-menu__hint">{hint}</span> : null}
      {active ? <i className="ri-check-line dh-menu-item__check" aria-hidden /> : null}
    </button>
  );
}

function ToggleItem({
  icon,
  label,
  title,
  checked,
  disabled,
  onChange,
}: {
  icon: string;
  label: string;
  title: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      className="dh-menu-item"
      title={title}
      onClick={() => onChange(!checked)}
    >
      <i className={`${icon} dh-menu-item__icon`} aria-hidden />
      <span className="dh-menu-item__label">{label}</span>
      <Checkbox checked={checked} />
    </button>
  );
}
