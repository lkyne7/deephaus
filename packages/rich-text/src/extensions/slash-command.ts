import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

export type SlashCommandItem = {
  id: string;
  title: string;
  description?: string;
  /** Remix icon class (rendered by the host app). */
  icon: string;
  /** Extra match terms for filtering. */
  keywords?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
};

export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, "editor">;
};

export function filterSlashItems(
  items: SlashCommandItem[],
  query: string,
): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const haystack = [item.title, item.description ?? "", ...(item.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Notion-style "/" menu. The host app provides `items` and `render` through
 * the suggestion options (the popup is host UI, not part of this package).
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
