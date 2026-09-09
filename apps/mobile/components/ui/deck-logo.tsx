import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type DeckLogoKind = "owned" | "published" | "community" | "subscribed";

const COMMUNITY_PURPLE = "#7c5cfc";
const PUBLISHED_BLUE = "#3b82f6";

/**
 * 32px tinted icon tile used next to deck names on web (dashboard table /
 * community list). Same marks and colors on iOS.
 */
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
      color: PUBLISHED_BLUE,
      background: "rgba(59, 130, 246, 0.15)",
    };
  }
  if (kind === "community") {
    return {
      icon: "earth",
      color: COMMUNITY_PURPLE,
      background: "rgba(124, 92, 252, 0.15)",
    };
  }
  if (kind === "subscribed") {
    return {
      icon: "bookmark",
      color: colors.brand700,
      background: colors.brand50,
    };
  }
  return {
    icon: "folder",
    color: colors.brand700,
    background: colors.brand50,
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
