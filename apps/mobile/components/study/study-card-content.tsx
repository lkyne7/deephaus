import { parseCardContent, parseImageOcclusionData } from "@deephaus/shared";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { RichCardContent } from "@/components/rich-card-content";
import { cardFontStyle, useCardFont } from "@/lib/study/card-font";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type StudyCard = {
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  cloze_ord?: number | null;
};

/** Card text set directly on the canvas, shared by study and cram sessions. */
export function StudyCardContent({
  card,
  revealed,
  fontScale,
}: {
  card: StudyCard;
  revealed: boolean;
  fontScale: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cardFont = useCardFont();
  const activeCloze = card.cloze_ord ?? undefined;

  if (card.type === "image-occlusion") {
    return (
      <>
        {parseCardContent(card.front ?? "")
          .filter((segment) => segment.type === "text" && segment.value.trim().length > 0)
          .map((segment, index) => (
            <Text
              key={index}
              style={[
                styles.occlusionHeader,
                cardFontStyle(cardFont),
                { fontSize: 21 * fontScale, lineHeight: 28 * fontScale },
              ]}
            >
              {segment.type === "text" ? segment.value.trim() : ""}
            </Text>
          ))}
        <OcclusionRenderer
          data={parseImageOcclusionData(card.occlusion_data)}
          activeOrd={activeCloze}
          revealed={revealed}
          studyView
          imageHeight={240 * fontScale}
        />
        {revealed && (card.back || card.extra) ? (
          <>
            <View style={styles.answerDivider} />
            <RichCardContent content={card.back ?? card.extra} studyView fontScale={fontScale} />
          </>
        ) : null}
      </>
    );
  }

  if (card.type === "basic") {
    return (
      <>
        <RichCardContent content={card.front} studyView fontScale={fontScale} />
        {revealed && card.back ? (
          <>
            <View style={styles.answerDivider} />
            <RichCardContent content={card.back} studyView fontScale={fontScale} />
          </>
        ) : null}
        {revealed && card.extra ? (
          <RichCardContent
            content={card.extra}
            studyView
            studyRole="extra"
            fontScale={fontScale}
            style={styles.extra}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <RichCardContent
        content={card.cloze_text}
        clozeMode={revealed ? "revealed" : "hidden"}
        activeClozeOrd={activeCloze}
        studyView
        fontScale={fontScale}
      />
      {revealed && card.extra ? (
        <RichCardContent
          content={card.extra}
          studyView
          studyRole="extra"
          fontScale={fontScale}
          style={styles.extra}
        />
      ) : null}
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    answerDivider: {
      alignSelf: "center",
      width: 48,
      height: 1,
      backgroundColor: colors.lineStrong,
      marginVertical: 24,
    },
    extra: {
      marginTop: 18,
    },
    occlusionHeader: {
      color: colors.fgPrimary,
      marginBottom: 14,
      textAlign: "center",
    },
  });
}
