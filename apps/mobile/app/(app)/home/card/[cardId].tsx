import { CardEditorScreen } from "@/components/card-editor/card-editor-screen";

// Cards opened from new cards on Home edit in place, so Home stays the active area.
export default function HomeCardScreen() {
  return <CardEditorScreen fallbackHref="/home" />;
}
