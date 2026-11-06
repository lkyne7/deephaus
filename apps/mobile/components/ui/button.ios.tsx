import {
  Button as SwiftButton,
  HStack,
  Host,
  Image as SwiftImage,
  ProgressView,
  Text as SwiftText,
} from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel as accessibilityLabelModifier,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, type ViewStyle } from "react-native";
import {
  PressableButton,
  variantStyles,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button-base";
import { liquidGlassAvailable } from "@/components/ui/glass-surface";
import { SF_SYMBOLS, type IconName } from "@/components/ui/icon-names";
import { useTheme } from "@/lib/theme-context";

export type { ButtonProps, ButtonSize, ButtonVariant };

/** SwiftUI's stand-in for double.infinity: wider than any screen. */
const FILL = 100_000;

const LAYOUT_KEYS = /^(margin|flex|align|position|top|left|right|bottom|width|minWidth|maxWidth|opacity)/;

const CONTROL_SIZE = { sm: "small", md: "regular", lg: "large", xl: "large" } as const;
const LABEL_SIZE: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 17, xl: 17 };
const ICON_SIZE: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 17, xl: 18 };

/** Glass styles fall back to a plain text button before iOS 26, so pick per OS. */
function nativeStyle(variant: ButtonVariant) {
  if (variant === "tertiary") return "borderless";
  if (variant === "secondary") return liquidGlassAvailable ? "glass" : "bordered";
  return liquidGlassAvailable ? "glassProminent" : "borderedProminent";
}

function symbol(icon: IconName | undefined) {
  return icon ? (SF_SYMBOLS[icon] as never) : undefined;
}

/** The layout a caller set on the button, for the host view that replaces it. */
function hostLayout(style: ButtonProps["style"]): { layout: ViewStyle; fills: boolean } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const picked = Object.keys(flat)
    .filter((key) => LAYOUT_KEYS.test(key))
    .map((key) => [key, flat[key]]);
  const layout = Object.fromEntries(picked) as ViewStyle;
  const fills =
    Boolean(layout.flex) ||
    layout.alignSelf === "stretch" ||
    typeof layout.width === "number" ||
    typeof layout.width === "string";
  return { layout, fills };
}

/**
 * System button on iOS: glass on iOS 26, bordered before it. Buttons hug their
 * label unless `fullWidth` or a stretching style is set.
 */
export function Button(props: ButtonProps) {
  const {
    label,
    children,
    variant = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    iconOnly = false,
    loading,
    disabled,
    fullWidth,
    style,
    textStyle,
    onPress,
    onLongPress,
    accessibilityLabel,
    accessibilityHint: hint,
  } = props;
  const { colors, colorScheme } = useTheme();
  const text = label ?? (typeof children === "string" ? children : undefined);

  // Custom content has no SwiftUI equivalent.
  if ((children != null && typeof children !== "string") || onLongPress) {
    return <PressableButton {...props} />;
  }

  const { layout, fills } = hostLayout(style);
  const fill = Boolean(fullWidth) || fills;
  const variants = variantStyles(colors);
  const flatText = StyleSheet.flatten(textStyle);
  const fg = (flatText?.color as string | undefined) ?? variants.fg[variant];
  const nativeTint = variant === "primary" || variant === "brand" || variant === "danger"
    ? variants.bg[variant]
    : fg;
  const leading = symbol(leadingIcon);
  const trailing = symbol(trailingIcon);
  const iconSize = ICON_SIZE[size];
  const a11y = accessibilityLabel ?? text;

  return (
    <Host
      ignoreSafeArea="all"
      key={fill ? "fill" : "hug"}
      matchContents={fill ? { vertical: true } : true}
      colorScheme={colorScheme}
      style={[fullWidth && { alignSelf: "stretch" }, layout]}
    >
      <SwiftButton
        onPress={() => onPress?.(undefined as never)}
        modifiers={[
          buttonStyle(nativeStyle(variant)),
          controlSize(CONTROL_SIZE[size]),
          buttonBorderShape(iconOnly ? "circle" : "capsule"),
          tint(nativeTint),
          disabledModifier(Boolean(disabled || loading)),
          ...(a11y ? [accessibilityLabelModifier(a11y)] : []),
          ...(hint ? [accessibilityHint(hint)] : []),
        ]}
      >
        <HStack
          spacing={6}
          modifiers={[
            ...(fill ? [frame({ maxWidth: FILL })] : []),
            ...(iconOnly ? [labelStyle("iconOnly")] : []),
          ]}
        >
          {loading ? (
            <ProgressView modifiers={[tint(fg)]} />
          ) : (
            <>
              {leading ? <SwiftImage systemName={leading} size={iconSize} color={fg} /> : null}
              {text && !iconOnly ? (
                <SwiftText
                  modifiers={[
                    font({ size: LABEL_SIZE[size], weight: "medium" }),
                    foregroundStyle(fg),
                  ]}
                >
                  {text}
                </SwiftText>
              ) : null}
              {trailing ? <SwiftImage systemName={trailing} size={iconSize} color={fg} /> : null}
            </>
          )}
        </HStack>
      </SwiftButton>
    </Host>
  );
}
