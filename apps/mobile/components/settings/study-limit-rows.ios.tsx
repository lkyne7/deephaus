import {
  Button,
  HStack,
  LabeledContent,
  Slider,
  Spacer,
  Text,
  TextField,
  VStack,
  type TextFieldRef,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  monospacedDigit,
  multilineTextAlignment,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useRef } from "react";

import {
  RETENTION_MAX_PCT,
  RETENTION_MIN_PCT,
  RECOMMENDED_RETENTION_PCT,
  retentionHint,
} from "@/lib/study/retention";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme-context";

/**
 * Desired retention as a native Form row: a slider from 70% to 97% with the
 * recommended 90% called out, and a button back to it. Place inside a Section.
 */
export function RetentionSliderRow({
  value,
  onChange,
  locked = false,
}: {
  value: number;
  onChange: (pct: number) => void;
  locked?: boolean;
}) {
  const { colors } = useTheme();
  const last = useRef(value);
  last.current = value;
  const recommended = value === RECOMMENDED_RETENTION_PCT;

  return (
    <VStack alignment="leading" spacing={8}>
      <HStack>
        <Text>Desired retention</Text>
        <Spacer />
        <Text modifiers={[monospacedDigit(), foregroundStyle(colors.fgSecondary)]}>
          {recommended ? `${value}% · Recommended` : `${value}%`}
        </Text>
      </HStack>
      <Slider
        value={value}
        min={RETENTION_MIN_PCT}
        max={RETENTION_MAX_PCT}
        step={1}
        onValueChange={(next) => {
          const pct = Math.round(next);
          if (pct === last.current) return;
          last.current = pct;
          haptics.selection();
          onChange(pct);
        }}
        minimumValueLabel={<Text modifiers={[font({ size: 13 }), foregroundStyle(colors.fgTertiary)]}>{`${RETENTION_MIN_PCT}%`}</Text>}
        maximumValueLabel={<Text modifiers={[font({ size: 13 }), foregroundStyle(colors.fgTertiary)]}>{`${RETENTION_MAX_PCT}%`}</Text>}
        modifiers={[tint(colors.accent), disabled(locked)]}
      />
      <HStack alignment="firstTextBaseline" spacing={8}>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(colors.fgTertiary)]}>
          {retentionHint(value)}
        </Text>
        {recommended ? null : (
          <>
            <Spacer />
            <Button
              label={`Use ${RECOMMENDED_RETENTION_PCT}%`}
              onPress={() => {
                haptics.selection();
                onChange(RECOMMENDED_RETENTION_PCT);
              }}
              // Borderless so only the button, not the whole Form row, takes the tap.
              modifiers={[buttonStyle("borderless"), font({ size: 13 }), tint(colors.accentInk), disabled(locked)]}
            />
          </>
        )}
      </HStack>
    </VStack>
  );
}

/**
 * A whole number typed on the number pad, as a native Form row. Saves as you
 * type; a number over `max` is lowered to `max`. With `allowEmpty`, an empty
 * field means null (e.g. no limit); otherwise leaving it empty puts the last
 * value back.
 */
export function NumberFieldRow({
  label,
  value,
  onChange,
  max,
  placeholder,
  allowEmpty = false,
  locked = false,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  max: number;
  placeholder?: string;
  allowEmpty?: boolean;
  locked?: boolean;
}) {
  const field = useRef<TextFieldRef>(null);
  // What the field shows. Starts empty so the value is pushed in on mount.
  const shown = useRef("");
  const valueRef = useRef(value);
  valueRef.current = value;
  const digitsLimit = String(max).length;

  const show = (text: string) => {
    if (text === shown.current) return;
    shown.current = text;
    void field.current?.setText(text);
  };

  // Changes from outside (loading settings, another control) replace the text,
  // but the user's own typing isn't echoed back.
  useEffect(() => {
    const typed = shown.current === "" ? null : Math.min(max, Number(shown.current));
    if (typed === value) return;
    show(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, max]);

  return (
    <LabeledContent label={label}>
      <TextField
        ref={field}
        placeholder={placeholder}
        maxLength={digitsLimit}
        onTextChange={(text) => {
          const digits = text.replace(/\D/g, "").slice(0, digitsLimit);
          if (digits !== text) {
            show(digits);
          } else {
            shown.current = digits;
          }
          if (digits === "") {
            if (allowEmpty) onChange(null);
            return;
          }
          onChange(Math.min(max, Number(digits)));
        }}
        onFocusChange={(focused) => {
          if (focused) return;
          const current = valueRef.current;
          // Tidy the text when editing ends: put back an emptied value, drop
          // leading zeros, and show a number that was lowered to the maximum.
          if (shown.current === "" && !allowEmpty) show(current == null ? "" : String(current));
          else if (shown.current !== "") show(String(Math.min(max, Number(shown.current))));
        }}
        modifiers={[
          keyboardType("numeric"),
          multilineTextAlignment("trailing"),
          monospacedDigit(),
          frame({ width: 96 }),
          disabled(locked),
        ]}
      />
    </LabeledContent>
  );
}
