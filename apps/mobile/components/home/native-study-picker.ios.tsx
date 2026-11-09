import { useState } from "react";
import { View } from "react-native";
import { Button, HStack, Host, Image, Menu, Section, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  fixedSize,
  foregroundStyle,
  frame,
  imageScale,
  layoutPriority,
  lineLimit,
  menuOrder,
  tint,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import {
  fullCount,
  shortCount,
  type StudyPickerProps,
} from "@/components/home/study-picker-types";
import { truncateTitle } from "@/lib/create-input";
import { useTheme } from "@/lib/theme-context";

/** SwiftUI's stand-in for double.infinity: wider than any screen. */
const FILL = 100_000;
const SPACING = 8;
/** The large glass Study button with its icon. */
const STUDY_WIDTH = 116;
/** The picker's padding, icon and count around the deck name. */
const PICKER_CHROME = 132;
const MIN_TITLE = 80;
/** About two lines of a menu row; iOS menus wrap rather than truncate. */
const MENU_NAME_CHARS = 40;

/**
 * Home's deck picker and Study button as system glass controls, the same
 * family as the composer's: a pull-down of your decks, each with its due and
 * new counts, and one prominent action. Sits in a SwiftUI Host of its own.
 */
export function NativeStudyPicker({ decks, selected, onSelect, onStudy }: StudyPickerProps) {
  const { colors, colorScheme } = useTheme();
  // A menu's glass label never shrinks on its own, so the deck name gets the
  // width that's left once Study, the count and the pill's own chrome fit.
  const [width, setWidth] = useState(0);
  const titleWidth = Math.max(MIN_TITLE, width - STUDY_WIDTH - SPACING - PICKER_CHROME);
  return (
    <View style={{ width: "100%" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Host matchContents={{ vertical: true }} colorScheme={colorScheme} style={{ width: "100%" }}>
        <HStack spacing={SPACING} alignment="center" modifiers={[frame({ maxWidth: FILL })]}>
          <Menu
            label={
              <HStack spacing={6}>
                <Image systemName="rectangle.stack" modifiers={[imageScale("small")]} />
                <Text
                  modifiers={[
                    lineLimit(1),
                    truncationMode("tail"),
                    frame({ maxWidth: titleWidth }),
                    fixedSize({ horizontal: true, vertical: false }),
                  ]}
                >
                  {selected.title}
                </Text>
                <Text
                  modifiers={[
                    foregroundStyle({
                      type: "hierarchical",
                      style: "secondary",
                    }),
                    fixedSize({ horizontal: true }),
                  ]}
                >
                  {shortCount(selected)}
                </Text>
              </HStack>
            }
            modifiers={[
              buttonStyle("glass"),
              controlSize("large"),
              lineLimit(1),
              layoutPriority(0),
              // Top to bottom, most recent first, even though the menu can open upward.
              menuOrder("fixed"),
            ]}
          >
            <Section title="Study a deck">
              {decks.map((deck) => (
                // Title and subtitle make SwiftUI's menu row with a detail
                // line; the chosen deck leads with a checkmark.
                <Button key={deck.id} onPress={() => onSelect(deck)}>
                  {[
                    ...(deck.id === selected.id ? [<Image key="check" systemName="checkmark" />] : []),
                    <Text key="title">{truncateTitle(deck.title, MENU_NAME_CHARS)}</Text>,
                    <Text key="count">{fullCount(deck)}</Text>,
                  ]}
                </Button>
              ))}
            </Section>
          </Menu>
          <Button
            label="Study"
            systemImage="play.fill"
            onPress={onStudy}
            modifiers={[
              buttonStyle("glassProminent"),
              controlSize("large"),
              tint(colors.actionBrandBg),
              fixedSize({ horizontal: true }),
              layoutPriority(1),
              ]}
          />
        </HStack>
      </Host>
    </View>
  );
}
