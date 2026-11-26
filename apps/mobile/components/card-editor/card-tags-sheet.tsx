import { ScrollView, StyleSheet } from "react-native";
import { CardTagsEditor } from "@/components/card-editor/card-tags-editor";
import { NativeSheet } from "@/components/ui/native-sheet";

/** Tags, edited from the card's Details group. */
export function CardTagsSheet({
  visible,
  onClose,
  tagsInput,
  onTagsChange,
  disabled,
}: {
  visible: boolean;
  onClose: () => void;
  tagsInput: string;
  onTagsChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <NativeSheet visible={visible} onClose={onClose} title="Tags">
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <CardTagsEditor value={tagsInput} onChange={onTagsChange} disabled={disabled} />
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
});
