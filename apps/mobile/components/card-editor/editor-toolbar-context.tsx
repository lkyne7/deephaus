import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { View } from "react-native";
import type {
  RichFieldCaret,
  RichFieldHandle,
  RichFieldState,
} from "@/components/card-editor/rich-field-types";

/** A card field the keyboard toolbar can act on. */
export type ToolbarField = {
  id: string;
  label: string;
  clozeEnabled: boolean;
  disabled: boolean;
  handle: RefObject<RichFieldHandle | null>;
  addImage: () => void;
  addAudio: () => void;
};

export type ActiveToolbarField = ToolbarField & { state: RichFieldState };

export type EditorPrompt =
  | { kind: "latex"; fieldId: string; formula: string; display: boolean; pos: number | null }
  | { kind: "hint"; fieldId: string; hint: string };

type EditorToolbarValue = {
  /** The focused field, or null while no editor has the keyboard. */
  active: ActiveToolbarField | null;
  reportState: (field: ToolbarField, state: RichFieldState) => void;
  getField: (id: string) => ToolbarField | undefined;
  prompt: EditorPrompt | null;
  openPrompt: (prompt: EditorPrompt) => void;
  closePrompt: () => void;
  ensureCaretVisible: (node: View | null, caret: RichFieldCaret) => void;
};

const EditorToolbarContext = createContext<EditorToolbarValue | null>(null);

/** Blur and refocus arrive as separate events; wait before hiding the toolbar. */
const BLUR_GRACE_MS = 150;

export function EditorToolbarProvider({
  children,
  ensureCaretVisible,
}: {
  children: ReactNode;
  ensureCaretVisible: (node: View | null, caret: RichFieldCaret) => void;
}) {
  const [active, setActive] = useState<ActiveToolbarField | null>(null);
  const [prompt, setPrompt] = useState<EditorPrompt | null>(null);
  const fieldsRef = useRef(new Map<string, ToolbarField>());
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportState = useCallback((field: ToolbarField, state: RichFieldState) => {
    fieldsRef.current.set(field.id, field);
    if (state.focused) {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      setActive({ ...field, state });
      return;
    }
    setActive((current) => {
      if (current?.id !== field.id) return current;
      if (!blurTimerRef.current) {
        blurTimerRef.current = setTimeout(() => {
          blurTimerRef.current = null;
          setActive((latest) => (latest?.id === field.id && !latest.state.focused ? null : latest));
        }, BLUR_GRACE_MS);
      }
      return { ...field, state };
    });
  }, []);

  const getField = useCallback((id: string) => fieldsRef.current.get(id), []);
  const closePrompt = useCallback(() => setPrompt(null), []);

  const value = useMemo<EditorToolbarValue>(
    () => ({
      active,
      reportState,
      getField,
      prompt,
      openPrompt: setPrompt,
      closePrompt,
      ensureCaretVisible,
    }),
    [active, reportState, getField, prompt, closePrompt, ensureCaretVisible],
  );

  return <EditorToolbarContext.Provider value={value}>{children}</EditorToolbarContext.Provider>;
}

export function useEditorToolbar(): EditorToolbarValue {
  const value = useContext(EditorToolbarContext);
  if (!value) throw new Error("useEditorToolbar must be used inside EditorToolbarProvider");
  return value;
}
