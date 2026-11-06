import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type DeckLogoKind = "owned" | "published" | "community" | "subscribed";

/** Quiet icon tile next to deck names; the mark, not a hue, carries the kind. */
export function DeckLogo({ kind = "owned", size = 32 }: { kind?: DeckLogoKind; size?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { icon, color, background } = logoForKind(kind, colors);
  const radius = Math.round(size * 0.25);

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: background,
        },
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

export function communityDeckLogoKind(deck: {
  is_owner?: boolean;
  is_subscribed?: boolean;
}): DeckLogoKind {
  if (deck.is_owner) return "published";
  if (deck.is_subscribed) return "subscribed";
  return "community";
}

/** Icons for the user's library (dashboard + study), matching web. */
export function ownedDeckLogoKind(deck: {
  is_community?: boolean;
  is_published?: boolean;
}): DeckLogoKind {
  if (deck.is_community) return "community";
  if (deck.is_published) return "published";
  return "owned";
}

function logoForKind(
  kind: DeckLogoKind,
  colors: ThemeColors,
): { icon: IconName; color: string; background: string } {
  if (kind === "published") {
    return {
      icon: "share",
      color: colors.fgSecondary,
      background: colors.bgSunken,
    };
  }
  if (kind === "community") {
    return {
      icon: "earth",
      color: colors.fgSecondary,
      background: colors.bgSunken,
    };
  }
  if (kind === "subscribed") {
    return {
      icon: "bookmark",
      color: colors.accentInk,
      background: colors.accentSoft,
    };
  }
  return {
    icon: "folder",
    color: colors.fgSecondary,
    background: colors.bgSunken,
  };
}

function createStyles(_colors: ThemeColors) {
  return StyleSheet.create({
    tile: {
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
  });
}
