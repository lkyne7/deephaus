import { useMemo } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { CardContent } from "@/components/card-content";
import { formatClozeForStudy } from "@/lib/cloze-display";

type Props = {
  content: string | null | undefined;
  clozeMode?: "hidden" | "revealed" | "none";
  activeClozeOrd?: number | null;
  studyView?: boolean;
  style?: StyleProp<ViewStyle>;
  minHeight?: number;
};

export function RichCardContent({
  content,
  clozeMode = "none",
  activeClozeOrd,
  style,
}: Props) {
  const text = useMemo(() => {
    if (!content) return "";
    if (typeof content !== "string") return "";
    return formatClozeForStudy(content, clozeMode, activeClozeOrd);
  }, [content, clozeMode, activeClozeOrd]);

  if (!text) return null;

  return <CardContent text={text} style={style} />;
}
