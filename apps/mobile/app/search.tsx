import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlobalSearchResults } from "@/components/global-search-results";
import { Icon } from "@/components/ui/icon";
import { goBackOrReplace } from "@/lib/navigation";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

function closeSearch() {
  goBackOrReplace("/home");
}

/**
 * Global search, opened from Home. Its own field is focused the moment the
 * screen mounts, so the keyboard rises while the screen fades in, as in
 * Claude's app, instead of waiting for a sheet and then a native search bar.
 */
export default function GlobalSearchScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.bar}>
        <View style={styles.field}>
          <Icon name="search" size={18} color={colors.fgTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search decks, cards, community"
            placeholderTextColor={colors.fgTertiary}
            accessibilityLabel="Search decks, cards and community"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={styles.input}
          />
        </View>
        <Pressable
          onPress={closeSearch}
          hitSlop={10}
          accessibilityRole="button"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
      <GlobalSearchResults query={query} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingLeft: 16,
      paddingRight: 18,
      paddingBottom: 8,
    },
    field: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.bgActive,
    },
    input: { flex: 1, height: 44, fontSize: 17, color: colors.fgPrimary },
    cancel: { fontSize: 17, lineHeight: 22, color: colors.accent },
    pressed: { opacity: 0.6 },
  });
}
