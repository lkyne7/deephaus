import { CardEditorScreen } from "@/components/card-editor/card-editor-screen";

// Cards opened from a deck's Cards tab edit in place, so Create stays the active tab.
export default function CreateCardScreen() {
  return <CardEditorScreen fallbackHref="/(tabs)/create" />;
}
