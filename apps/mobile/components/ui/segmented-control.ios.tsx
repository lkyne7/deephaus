import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme-context";

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/** System segmented picker. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  const { colorScheme } = useTheme();
  return (
    <Host
      ignoreSafeArea="all"
      matchContents={{ vertical: true }}
      colorScheme={colorScheme}
      style={{ alignSelf: "stretch" }}
    >
      <Picker
        selection={value}
        onSelectionChange={(next: T) => {
          haptics.selection();
          onChange(next);
        }}
        modifiers={[pickerStyle("segmented")]}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
