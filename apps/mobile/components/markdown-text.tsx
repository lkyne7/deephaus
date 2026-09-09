import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ClozeText } from "@/components/cloze-text";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const ORDERED = /^\s*(\d+)\.\s+(.+)$/;

function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ type: "paragraph", text });
  };

  const flushList = () => {
    if (!list || list.items.length === 0) {
      list = null;
      return;
    }
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line.trim());
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) list = { ordered: false, items: [] };
      list.items.push(bullet[1].trim());
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) list = { ordered: true, items: [] };
      list.items.push(ordered[2].trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

/** Lightweight markdown for AI explanations: headings, lists, and bold. */
export function MarkdownText({ content }: { content: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  if (!content.trim() || blocks.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <ClozeText
              key={`h-${index}`}
              text={block.text}
              textStyle={
                block.level === 1
                  ? styles.h1
                  : block.level === 2
                    ? styles.h2
                    : styles.h3
              }
            />
          );
        }
        if (block.type === "list") {
          return (
            <View key={`l-${index}`} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listItem}>
                  <Text style={styles.bullet}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <View style={styles.listText}>
                    <ClozeText text={item} textStyle={styles.body} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return <ClozeText key={`p-${index}`} text={block.text} textStyle={styles.body} />;
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: 12 },
    h1: {
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    h2: {
      fontSize: 17,
      lineHeight: 23,
      fontWeight: "700",
      color: colors.fgPrimary,
    },
    h3: {
      fontSize: 15,
      lineHeight: 21,
      fontWeight: "700",
      color: colors.fgPrimary,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.fgPrimary,
    },
    list: { gap: 8 },
    listItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    listText: { flex: 1, minWidth: 0 },
    bullet: {
      width: 18,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgTertiary,
    },
  });
}
