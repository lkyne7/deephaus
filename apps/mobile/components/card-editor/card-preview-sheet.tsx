import { ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { StudyCardContent } from "@/components/study/study-card-content";
import { NativeSheet } from "@/components/ui/native-sheet";

type PreviewCard = {
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
};

/** The card as study shows it with the answer up, from the editor's Preview. */
export function CardPreviewSheet({
  visible,
  onClose,
  card,
}: {
  visible: boolean;
  onClose: () => void;
  card: PreviewCard;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <NativeSheet visible={visible} onClose={onClose} title="Preview">
      <ScrollView contentContainerStyle={styles.body}>
        {visible ? <StudyCardContent card={card} revealed fontScale={fontScale} /> : null}
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
});
