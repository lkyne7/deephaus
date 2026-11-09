import {
  CARD_MODEL_NAME,
  DETAIL_LEVEL_OPTIONS,
  FOCUS_PRESET_OPTIONS,
  QUALITY_LEVEL_OPTIONS,
  type DetailLevel,
  type FocusPreset,
  type QualityLevel,
} from "@deephaus/shared";
import { Divider, Image, Menu, Picker, Text, Toggle } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  labelStyle,
  menuOrder,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import type { CardTypeChoice, CreateOptions } from "@/lib/create-options";

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
  const blanks = options.cardType !== "basic";
  const valueOf = <T extends string>(list: { value: T; label: string }[], value: T) =>
    list.find((option) => option.value === value)?.label ?? "";
  return (
    // The web pill reads "Haus 5.5 · Medium". Beside the deck picker a phone
    // has room for the icon only, like the composer's other round buttons;
    // VoiceOver still hears the model and effort.
    <Menu
      label={`Card settings: ${CARD_MODEL_NAME}, ${effortLabel(options)} effort`}
      systemImage="slider.horizontal.3"
      modifiers={[
        buttonStyle("glass"),
        buttonBorderShape("circle"),
        controlSize("large"),
        labelStyle("iconOnly"),
        // Top to bottom as on the web, even though the menu opens upward.
        menuOrder("fixed"),
      ]}
    >
      <Picker<QualityLevel>
        label={settingLabel("sparkles", "Effort", effortLabel(options))}
        selection={options.qualityLevel}
        onSelectionChange={(qualityLevel) => onChange({ ...options, qualityLevel })}
        modifiers={[pickerStyle("menu")]}
      >
        {QUALITY_LEVEL_OPTIONS.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
      <Picker<DetailLevel>
        label={settingLabel("square.stack.3d.up", "Detail", valueOf(DETAIL_LEVEL_OPTIONS, options.detailLevel))}
        selection={options.detailLevel}
        onSelectionChange={(detailLevel) => onChange({ ...options, detailLevel })}
        modifiers={[pickerStyle("menu")]}
      >
        {DETAIL_LEVEL_OPTIONS.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
      <Picker<FocusPreset>
        label={settingLabel("scope", "Focus", valueOf(FOCUS_PRESET_OPTIONS, options.focusPreset))}
        selection={options.focusPreset}
        onSelectionChange={(focusPreset) => onChange({ ...options, focusPreset })}
        modifiers={[pickerStyle("menu")]}
      >
        {FOCUS_PRESET_OPTIONS.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
      <Picker<CardTypeChoice>
        label={settingLabel("rectangle.grid.1x2", "Card types", valueOf(CARD_TYPE_CHOICES, options.cardType))}
        selection={options.cardType}
        onSelectionChange={(cardType) => onChange({ ...options, cardType })}
        modifiers={[pickerStyle("menu")]}
      >
        {CARD_TYPE_CHOICES.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
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
