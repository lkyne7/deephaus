import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { StudyCardContent } from "@/components/study/study-card-content";
import { Button } from "@/components/ui/button";
import { NativeSheet } from "@/components/ui/native-sheet";

type PreviewCard = {
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
};

/**
 * The card as study shows it, from the card page's Preview: the question
 * first, then Show answer reveals the back, as in a study session.
 */
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
  const [revealed, setRevealed] = useState(false);
  // Each opening starts on the question.
  useEffect(() => {
    if (visible) setRevealed(false);
  }, [visible]);

  return (
    <NativeSheet visible={visible} onClose={onClose} title="Preview">
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          {visible ? (
            <StudyCardContent card={card} revealed={revealed} fontScale={fontScale} />
          ) : null}
        </ScrollView>
        <View style={styles.dock}>
          {revealed ? (
            <Button
              variant="secondary"
              size="xl"
              label="Show question only"
              fullWidth
              onPress={() => setRevealed(false)}
            />
          ) : (
            <Button
              variant="primary"
              size="xl"
              label="Show answer"
              fullWidth
              onPress={() => setRevealed(true)}
            />
          )}
        </View>
      </View>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  dock: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
});
