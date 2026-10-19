import { View, Text, Pressable } from "react-native";
import {
  EASY_DAY_NAMES,
  EASY_DAY_LEVELS,
  EASY_DAYS_DESCRIPTION,
  normalEasyDays,
  weekendWarriorDays,
  type EasyDays,
} from "@deephaus/shared";
import { useTheme } from "@/lib/theme-context";

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
  const choice = (
    label: string,
    active: boolean,
    action: () => void,
    accessibilityLabel = label,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={action}
      style={{
        paddingHorizontal: 10,
        minHeight: 44,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 8,
        backgroundColor: active ? colors.brand50 : colors.bgCanvas,
        borderWidth: 1,
        borderColor: active ? colors.borderBrand : colors.borderSecondary,
        flex: 1,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: active ? colors.brand700 : colors.fgSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <Text
        style={{ fontSize: 15, fontWeight: "600", color: colors.fgPrimary }}
      >
        Easy Days
      </Text>
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.fgTertiary }}>
        {EASY_DAYS_DESCRIPTION}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {choice(
          "Normal week",
          value.every((day) => day === "normal"),
          () => onChange(normalEasyDays()),
        )}
        {choice(
          "Weekend warrior",
          JSON.stringify(value) === JSON.stringify(weekendWarriorDays()),
          () => onChange(weekendWarriorDays()),
        )}
      </View>
      <Text style={{ fontSize: 12, color: colors.fgTertiary }}>
        Weekend warrior: lighter Saturdays and Sundays.
      </Text>
      {EASY_DAY_NAMES.map((day, i) => (
        <View key={day} style={{ gap: 5 }}>
          <Text style={{ color: colors.fgSecondary, fontSize: 12 }}>{day}</Text>
          <View
            accessibilityLabel={`${day} review load`}
            style={{ flexDirection: "row", gap: 6 }}
          >
            {EASY_DAY_LEVELS.map((level) =>
              choice(
                level[0].toUpperCase() + level.slice(1),
                value[i] === level,
                () =>
                  onChange(value.map((v, index) => (index === i ? level : v))),
                `${day}: ${level}`,
              ),
            )}
          </View>
        </View>
      ))}
      {!value.includes("normal") && (
        <Text accessibilityRole="alert" style={{ color: colors.gradeAgain }}>
          Keep at least one day set to Normal.
        </Text>
      )}
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.fgTertiary }}>
        These preferences reduce future reviews; they do not guarantee a day
        off.
      </Text>
    </View>
  );
}
