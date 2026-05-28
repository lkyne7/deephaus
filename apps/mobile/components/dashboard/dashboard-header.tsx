import { useMemo } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DeckSelect, DeckSelectLabel } from "@/components/ui/deck-select";
import { useTheme } from "@/lib/theme-context";
import { layout, type ThemeColors } from "@/lib/theme";

const COLLAPSE_DISTANCE = 108;
const EXPANDED_STUDY_HEIGHT = 132;

type DeckSummary = {
  name: string;
  due: number;
  new: number;
};

type Props = {
  scrollY: Animated.Value;
  title?: string;
  initials: string;
  selectedDeck?: DeckSummary | null;
  onProfilePress: () => void;
  onDeckPress: () => void;
  onStudyPress: () => void;
  deckDisabled?: boolean;
  studyDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

function deckLabel(deck: DeckSummary | null | undefined, compact: boolean) {
  if (!deck) return "No decks yet";
  if (compact) {
    return deck.name.length > 22 ? `${deck.name.slice(0, 21)}…` : deck.name;
  }
  return `${deck.name} (${deck.due} due · ${deck.new} new)`;
}

export function DashboardHeader({
  scrollY,
  title = "Dashboard",
  initials,
  selectedDeck,
  onProfilePress,
  onDeckPress,
  onStudyPress,
  deckDisabled,
  studyDisabled,
  style,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const expandedHeight = scrollY.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE],
    outputRange: [EXPANDED_STUDY_HEIGHT, 0],
    extrapolate: "clamp",
  });

  const expandedOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE * 0.55, COLLAPSE_DISTANCE],
    outputRange: [1, 0.2, 0],
    extrapolate: "clamp",
  });

  const titleOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE * 0.35, COLLAPSE_DISTANCE * 0.7],
    outputRange: [1, 0.2, 0],
    extrapolate: "clamp",
  });

  const compactOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE * 0.35, COLLAPSE_DISTANCE * 0.7],
    outputRange: [0, 0.2, 1],
    extrapolate: "clamp",
  });

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, style]}>
      <View style={styles.titleRow}>
        <View style={styles.centerSlot}>
          <Animated.View
            style={[styles.titleLayer, { opacity: titleOpacity }]}
            pointerEvents="none"
          >
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </Animated.View>

          <Animated.View
            style={[styles.compactLayer, { opacity: compactOpacity }]}
            pointerEvents="box-none"
          >
            <DeckSelect
              small
              value={deckLabel(selectedDeck, true)}
              onPress={onDeckPress}
              disabled={deckDisabled}
              style={styles.compactDeckSelect}
            />
            <Button
              variant="brand"
              size="sm"
              pill
              label="Study"
              trailingIcon="arrowRight"
              disabled={studyDisabled}
              onPress={onStudyPress}
              style={styles.compactStudyButton}
            />
          </Animated.View>
        </View>

        <View style={styles.avatarSlot}>
          <Pressable
            onPress={onProfilePress}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            <Avatar initials={initials} size="md" />
          </Pressable>
        </View>
      </View>

      <Animated.View
        style={[
          styles.expandedWrap,
          {
            height: expandedHeight,
            opacity: expandedOpacity,
          },
        ]}
      >
        <View style={styles.expandedInner}>
          <DeckSelectLabel>Deck</DeckSelectLabel>
          <DeckSelect
            value={deckLabel(selectedDeck, false)}
            onPress={onDeckPress}
            disabled={deckDisabled}
          />
          <Button
            variant="brand"
            size="lg"
            pill
            label="Study Now"
            trailingIcon="arrowRight"
            disabled={studyDisabled}
            onPress={onStudyPress}
            style={{ marginTop: 10 }}
            fullWidth
          />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: {
      backgroundColor: colors.bgSurface,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      height: layout.appHeaderRowHeight,
      paddingHorizontal: 16,
    },
    centerSlot: {
      flex: 1,
      minWidth: 0,
      minHeight: 40,
      position: "relative",
      justifyContent: "center",
    },
    titleLayer: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "center",
    },
    title: {
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    compactLayer: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    compactDeckSelect: {
      flex: 1,
      minWidth: 0,
    },
    compactStudyButton: {
      flexShrink: 0,
    },
    avatarSlot: {
      flexShrink: 0,
    },
    expandedWrap: {
      overflow: "hidden",
    },
    expandedInner: {
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
  });
}
