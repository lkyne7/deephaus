import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import type { CreateOptions } from "@/lib/create-options";

/** What callers can do to the composer, whichever text field draws it. */
export type ComposerHandle = {
  focus: () => void;
  blur: () => void;
};

export type ComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** What the composer will do with its text, so a wrong guess is visible. */
  hint?: string | null;
  /** A picked file. The text then becomes instructions for that file. */
  attachmentName?: string | null;
  onRemoveAttachment?: () => void;
  onAdd: () => void;
  deckLabel: string;
  deckEntries: NativeMenuEntry[];
  /** Opens the card options sheet (the RN composer). */
  onOptions: () => void;
  /** The card options, for the native composer's pull-down menu. */
  cardOptions?: { value: CreateOptions; onChange: (options: CreateOptions) => void };
  onSend: () => void;
  canSend: boolean;
  sending?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
};
