"use client";

import {
  SlashCommand,
  filterSlashItems,
  type SlashCommandItem,
} from "@deephaus/rich-text";
import type { Editor, Range } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SlashSession = {
  items: SlashCommandItem[];
  rect: DOMRect | null;
  command: (item: SlashCommandItem) => void;
};

/**
 * Chain methods used by slash items. The source-doc extensions live in
 * @deephaus/rich-text, so most command augmentations aren't visible here.
 */
type SlashChain = {
  focus: () => SlashChain;
  deleteRange: (range: Range) => SlashChain;
  setParagraph: () => SlashChain;
  setNode: (name: string, attrs?: Record<string, unknown>) => SlashChain;
  toggleBulletList: () => SlashChain;
  toggleOrderedList: () => SlashChain;
  toggleTaskList: () => SlashChain;
  toggleBlockquote: () => SlashChain;
  toggleCodeBlock: () => SlashChain;
  setHorizontalRule: () => SlashChain;
  insertTable: (opts: { rows: number; cols: number; withHeaderRow: boolean }) => SlashChain;
  setCallout: () => SlashChain;
  insertToggle: () => SlashChain;
  insertLatexInline: (formula?: string) => SlashChain;
  insertLatexBlock: (formula?: string) => SlashChain;
  run: () => boolean;
};

function slashChain(editor: Editor, range: Range): SlashChain {
  return (editor.chain().focus() as unknown as SlashChain).deleteRange(range);
}

export function buildSlashItems(options: {
  onInsertImage?: () => void;
  onEdit?: () => void;
}): SlashCommandItem[] {
  const edit = () => options.onEdit?.();
  const items: SlashCommandItem[] = [
    {
      id: "text",
      title: "Text",
      description: "Plain paragraph",
      icon: "ri-text",
      keywords: ["paragraph", "plain"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).setParagraph().run();
      },
    },
    {
      id: "h1",
      title: "Heading 1",
      description: "Large section heading",
      icon: "ri-h-1",
      keywords: ["title", "big"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).setNode("heading", { level: 1 }).run();
      },
    },
    {
      id: "h2",
      title: "Heading 2",
      description: "Medium section heading",
      icon: "ri-h-2",
      keywords: ["subtitle"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).setNode("heading", { level: 2 }).run();
      },
    },
    {
      id: "h3",
      title: "Heading 3",
      description: "Small section heading",
      icon: "ri-h-3",
      keywords: ["subheading"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).setNode("heading", { level: 3 }).run();
      },
    },
    {
      id: "bullet-list",
      title: "Bulleted list",
      description: "Simple list with bullets",
      icon: "ri-list-unordered",
      keywords: ["unordered", "ul"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).toggleBulletList().run();
      },
    },
    {
      id: "ordered-list",
      title: "Numbered list",
      description: "List with numbering",
      icon: "ri-list-ordered",
      keywords: ["ordered", "ol"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).toggleOrderedList().run();
      },
    },
    {
      id: "task-list",
      title: "To-do list",
      description: "List with checkboxes",
      icon: "ri-checkbox-line",
      keywords: ["task", "todo", "checkbox", "check"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).toggleTaskList().run();
      },
    },
    {
      id: "toggle",
      title: "Toggle",
      description: "Collapsible content block",
      icon: "ri-arrow-right-s-fill",
      keywords: ["collapse", "details", "accordion"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).insertToggle().run();
      },
    },
    {
      id: "callout",
      title: "Callout",
      description: "Emphasized block with an icon",
      icon: "ri-lightbulb-line",
      keywords: ["highlight", "info", "warning", "note"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).setCallout().run();
      },
    },
    {
      id: "quote",
      title: "Quote",
      description: "Block quotation",
      icon: "ri-double-quotes-l",
      keywords: ["blockquote"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).toggleBlockquote().run();
      },
    },
    {
      id: "table",
      title: "Table",
      description: "3×3 table with a header row",
      icon: "ri-table-2",
      keywords: ["grid", "rows", "columns"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      },
    },
    {
      id: "code",
      title: "Code block",
      description: "Code with syntax highlighting",
      icon: "ri-code-box-line",
      keywords: ["snippet", "pre", "programming"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).toggleCodeBlock().run();
      },
    },
    {
      id: "divider",
      title: "Divider",
      description: "Horizontal rule",
      icon: "ri-separator",
      keywords: ["hr", "line", "rule", "separator"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).setHorizontalRule().run();
      },
    },
    {
      id: "equation-inline",
      title: "Inline equation",
      description: "LaTeX within a line of text",
      icon: "ri-formula",
      keywords: ["latex", "math", "katex"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).insertLatexInline("x").run();
      },
    },
    {
      id: "equation-block",
      title: "Block equation",
      description: "Standalone LaTeX equation",
      icon: "ri-functions",
      keywords: ["latex", "math", "katex", "display"],
      command: ({ editor, range }) => {
        edit();
        slashChain(editor, range).insertLatexBlock("\\frac{a}{b}").run();
      },
    },
  ];

  if (options.onInsertImage) {
    items.push({
      id: "image",
      title: "Image",
      description: "Upload and embed an image",
      icon: "ri-image-add-line",
      keywords: ["picture", "photo", "upload"],
      command: ({ editor, range }) => {
        edit();
        (editor.chain().focus() as unknown as SlashChain).deleteRange(range).run();
        options.onInsertImage?.();
      },
    });
  }

  return items;
}

/**
 * Owns the "/" menu session state and returns both the configured TipTap
 * extension and the rendered popup element.
 */
export function useSlashMenu(options: {
  onInsertImage?: () => void;
  onEdit?: () => void;
}) {
  const [session, setSession] = useState<SlashSession | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const sessionRef = useRef<SlashSession | null>(null);
  sessionRef.current = session;
  const selectedRef = useRef(0);
  selectedRef.current = selectedIndex;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const extension = useMemo(
    () =>
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          items: ({ query }) =>
            filterSlashItems(
              buildSlashItems({
                onInsertImage: optionsRef.current.onInsertImage,
                onEdit: optionsRef.current.onEdit,
              }),
              query,
            ),
          command: ({ editor, range, props }) => {
            props.command({ editor, range });
          },
          render: () => ({
            onStart: (props) => {
              setSelectedIndex(0);
              setSession({
                items: props.items,
                rect: props.clientRect?.() ?? null,
                command: props.command,
              });
            },
            onUpdate: (props) => {
              setSelectedIndex(0);
              setSession({
                items: props.items,
                rect: props.clientRect?.() ?? null,
                command: props.command,
              });
            },
            onKeyDown: ({ event }) => {
              const current = sessionRef.current;
              if (!current || current.items.length === 0) {
                if (event.key === "Escape") {
                  setSession(null);
                  return true;
                }
                return false;
              }
              if (event.key === "ArrowDown") {
                setSelectedIndex((index) => (index + 1) % current.items.length);
                return true;
              }
              if (event.key === "ArrowUp") {
                setSelectedIndex(
                  (index) => (index - 1 + current.items.length) % current.items.length,
                );
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = current.items[selectedRef.current];
                if (item) current.command(item);
                return true;
              }
              if (event.key === "Escape") {
                setSession(null);
                return true;
              }
              return false;
            },
            onExit: () => {
              setSession(null);
            },
          }),
        },
      }),
    [],
  );

  const menu =
    session && session.rect && session.items.length > 0 ? (
      <SlashMenuPopup
        session={session}
        selectedIndex={selectedIndex}
        onHover={setSelectedIndex}
      />
    ) : null;

  return { extension, menu };
}

function SlashMenuPopup({
  session,
  selectedIndex,
  onHover,
}: {
  session: SlashSession;
  selectedIndex: number;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const rect = session.rect!;
  const menuMaxHeight = 320;
  const openUp =
    typeof window !== "undefined" &&
    rect.bottom + menuMaxHeight + 12 > window.innerHeight &&
    rect.top > menuMaxHeight;

  return createPortal(
    <div
      ref={listRef}
      className="dh-slash-menu"
      role="listbox"
      aria-label="Insert block"
      style={{
        left: Math.min(
          rect.left,
          typeof window !== "undefined" ? window.innerWidth - 300 : rect.left,
        ),
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      }}
    >
      {session.items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          data-selected={index === selectedIndex ? "true" : undefined}
          className={`dh-slash-menu__item${index === selectedIndex ? " is-selected" : ""}`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => session.command(item)}
        >
          <span className="dh-slash-menu__icon" aria-hidden>
            <i className={item.icon} />
          </span>
          <span className="dh-slash-menu__copy">
            <span className="dh-slash-menu__title">{item.title}</span>
            {item.description ? (
              <span className="dh-slash-menu__description">{item.description}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
