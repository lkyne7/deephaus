import { useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { GlobalSearchResults } from "@/components/global-search-results";
import { Field } from "@/components/ui/input";
import { ScreenHeader } from "@/components/ui/screen-header";
import { goBackOrReplace } from "@/lib/navigation";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

function closeSearch() {
  goBackOrReplace("/(tabs)/dashboard");
}

export default function GlobalSearchScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState("");

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Search"
        backFallback="/(tabs)/dashboard"
        search={{
          placeholder: "Search decks, cards, community…",
          autoFocus: true,
          onChangeText: setQuery,
          onCancel: closeSearch,
        }}
        actions={[
          {
            icon: "close",
            sfIcon: "xmark",
            label: "Close search",
            onPress: closeSearch,
          },
        ]}
      />
      {Platform.OS !== "ios" ? (
        <View style={styles.searchRow}>
          <Field
            leadingIcon="search"
            placeholder="Search decks, cards, community…"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      ) : null}
      <GlobalSearchResults query={query} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    searchRow: { paddingHorizontal: 16, paddingTop: 12 },
  });
}
