import {
  CARD_MODEL_NAME,
  DETAIL_LEVEL_OPTIONS,
  FOCUS_PRESET_OPTIONS,
  QUALITY_LEVEL_OPTIONS,
} from "@deephaus/shared";
import { Divider, Image, Menu, Text, Toggle } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import {
  accessibilityLabel,
  buttonStyle,
  disabled as disabledModifier,
  menuIndicator,
  menuOrder,
} from "@expo/ui/swift-ui/modifiers";
import { CircleLabel } from "@/components/create/composer-buttons.ios";
import type { CardTypeChoice, CreateOptions } from "@/lib/create-options";
import { useTheme } from "@/lib/theme-context";

type SymbolName = NonNullable<ComponentProps<typeof Image>["systemName"]>;

/** Card types as the web names them; "Both" makes front/back and blanks. */
export const CARD_TYPE_CHOICES: { value: CardTypeChoice; label: string }[] = [
  { value: "basic", label: "Front/Back" },
  { value: "cloze", label: "Fill-in-the-Blank" },
  { value: "both", label: "Both" },
];

/**
 * A menu row's label as on the web: icon, the setting's name, and its current
 * value. SwiftUI draws an image and two texts as icon, title and subtitle.
 */
function settingLabel(icon: SymbolName, title: string, value: string) {
  return (
    <>
      <Image systemName={icon} />
      <Text>{title}</Text>
      <Text>{value}</Text>
    </>
  );
}

function effortLabel(options: CreateOptions) {
  return (
    QUALITY_LEVEL_OPTIONS.find((option) => option.value === options.qualityLevel)?.label ??
    "Medium"
  );
}

/**
 * One setting as a submenu of ticked choices. Not a SwiftUI Picker: inside a
 * Menu a Picker draws as menu items and its onChange never runs, so a choice
 * never reached JS. Toggles report through their binding, which works there.
 * Each toggle remounts when its tick changes, as in native-menu's items.
 */
function choiceMenu<T extends string>(
  icon: SymbolName,
  title: string,
  list: readonly { value: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
) {
  const value = list.find((option) => option.value === current)?.label ?? "";
  return (
    <Menu key={title} label={settingLabel(icon, title, value)}>
      {list.map((option) => (
        <Toggle
          key={`${option.value}-${option.value === current}`}
          label={option.label}
          isOn={option.value === current}
          onIsOnChange={() => onPick(option.value)}
        />
      ))}
    </Menu>
  );
}

/**
 * The web's card settings menu as a native pull-down: Effort, Detail, Focus
 * and Card types each show their value and open their choices, then Auto
 * tags and Hints on blanks switch on and off. Must sit inside a SwiftUI Host.
 */
export function CardOptionsMenu({
  options,
  onChange,
}: {
  options: CreateOptions;
  onChange: (options: CreateOptions) => void;
}) {
  const { colors } = useTheme();
  const blanks = options.cardType !== "basic";
  return (
    // The web pill reads "Haus 5.5 · Medium". Beside the deck picker a phone
    // has room for the icon only, like the composer's other round buttons;
    // VoiceOver still hears the model and effort.
    <Menu
      label={<CircleLabel systemName="slider.horizontal.3" colors={colors} />}
      modifiers={[
        buttonStyle("plain"),
        menuIndicator("hidden"),
        accessibilityLabel(`Card settings: ${CARD_MODEL_NAME}, ${effortLabel(options)} effort`),
        // Top to bottom as on the web, even though the menu opens upward.
        menuOrder("fixed"),
      ]}
    >
      {choiceMenu("sparkles", "Effort", QUALITY_LEVEL_OPTIONS, options.qualityLevel, (qualityLevel) =>
        onChange({ ...options, qualityLevel }),
      )}
      {choiceMenu("square.stack.3d.up", "Detail", DETAIL_LEVEL_OPTIONS, options.detailLevel, (detailLevel) =>
        onChange({ ...options, detailLevel }),
      )}
      {choiceMenu("scope", "Focus", FOCUS_PRESET_OPTIONS, options.focusPreset, (focusPreset) =>
        onChange({ ...options, focusPreset }),
      )}
      {choiceMenu("rectangle.grid.1x2", "Card types", CARD_TYPE_CHOICES, options.cardType, (cardType) =>
        onChange({ ...options, cardType }),
      )}
      <Divider />
      <Toggle
        label="Auto tags"
        systemImage="tag"
        isOn={options.autoTags}
        onIsOnChange={(autoTags) => onChange({ ...options, autoTags })}
      />
      <Toggle
        label="Hints on blanks"
        systemImage="lightbulb"
        isOn={blanks && options.clozeHints}
        onIsOnChange={(clozeHints) => onChange({ ...options, clozeHints })}
        modifiers={blanks ? undefined : [disabledModifier(true)]}
      />
    </Menu>
  );
}
