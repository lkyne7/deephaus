import { View, Text } from "react-native";
import {
  EASY_DAY_NAMES,
  EASY_DAY_LEVELS,
  EASY_DAYS_DESCRIPTION,
  normalEasyDays,
  weekendWarriorDays,
  type EasyDays,
} from "@deephaus/shared";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTheme } from "@/lib/theme-context";

const LEVEL_OPTIONS = EASY_DAY_LEVELS.map((level) => ({
  value: level,
  label: level[0].toUpperCase() + level.slice(1),
}));

export function EasyDaysSettings({
  value,
  onChange,
  disabled,
}: {
  value: EasyDays;
  onChange: (value: EasyDays) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.fgTertiary }}>
        {EASY_DAYS_DESCRIPTION}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          variant="secondary"
          size="md"
          label="Normal week"
          disabled={disabled}
          onPress={() => onChange(normalEasyDays())}
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          size="md"
          label="Weekend warrior"
          disabled={disabled}
          onPress={() => onChange(weekendWarriorDays())}
          style={{ flex: 1 }}
        />
      </View>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.fgTertiary }}>
        Weekend warrior: lighter Saturdays and Sundays.
      </Text>
      {EASY_DAY_NAMES.map((day, i) => (
        <View key={day} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ width: 92, color: colors.fgPrimary, fontSize: 15 }}>{day}</Text>
          <View style={{ flex: 1 }} pointerEvents={disabled ? "none" : "auto"}>
            <SegmentedControl
              accessibilityLabel={`${day} review load`}
              options={LEVEL_OPTIONS}
              value={value[i]}
              onChange={(level) =>
                onChange(value.map((v, index) => (index === i ? level : v)))
              }
            />
          </View>
        </View>
      ))}
      {!value.includes("normal") && (
        <Text accessibilityRole="alert" style={{ fontSize: 13, color: colors.danger }}>
          Keep at least one day set to Normal.
        </Text>
      )}
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.fgTertiary }}>
        These preferences reduce future reviews; they do not guarantee a day off.
      </Text>
    </View>
  );
}
