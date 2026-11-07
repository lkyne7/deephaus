import { CardEditorScreen } from "@/components/card-editor/card-editor-screen";

// Cards opened from a deck page edit in place, so Decks stays the active area.
export default function DeckCardScreen() {
  return <CardEditorScreen fallbackHref="/decks" />;
}
