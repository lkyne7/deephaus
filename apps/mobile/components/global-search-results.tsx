import type {
  GlobalSearchHit,
  GlobalSearchKind,
  GlobalSearchResponse,
} from "@deephaus/api-client";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon, type IconName } from "@/components/ui/icon";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { searchListKeyboardDismiss } from "@/components/ui/screen-header";
import { useTheme } from "@/lib/theme-context";

const SECTIONS: Array<{
  kind: GlobalSearchKind;
  label: string;
  icon: IconName;
}> = [
  { kind: "card", label: "Cards", icon: "layers" },
  { kind: "deck", label: "Decks", icon: "book" },
  { kind: "community", label: "Community", icon: "community" },
];

function navigateToHit(hit: GlobalSearchHit) {
  Keyboard.dismiss();
  // Close the search sheet first, so the result opens inside the app, not over it.
  if (router.canGoBack()) router.back();
  if (hit.kind === "card") {
    router.push(`/cards/${hit.id}`);
  } else if (hit.kind === "deck") {
    router.push(`/decks/${hit.id}`);
  } else {
    router.navigate({
      pathname: "/community",
      params: { q: hit.title },
    });
  }
}

type Props = {
  query: string;
};

/**
 * Debounced global search (cards, decks, community) rendered as grouped
 * result sections, inside the search sheet.
 */
export function GlobalSearchResults({ query }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [results, setResults] = useState<GlobalSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await api.globalSearch(trimmed, 5);
        if (requestSeq.current !== seq) return;
        setResults(response);
        setError(null);
      } catch {
        if (requestSeq.current !== seq) return;
        setError("Search failed. Try again.");
        setResults(null);
      } finally {
        if (requestSeq.current === seq) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const grouped = useMemo(() => {
    if (!results) return [];
    return SECTIONS.map((section) => ({
      ...section,
      hits: results.results.filter((hit) => hit.kind === section.kind),
    })).filter((section) => section.hits.length > 0);
  }, [results]);

  const hasQuery = query.trim().length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={searchListKeyboardDismiss}
    >
      {!hasQuery ? (
        <View style={styles.stateBox}>
          <FeaturedIcon icon="search" variant="gray" size="lg" />
          <Text style={styles.stateTitle}>Search everything</Text>
          <Text style={styles.stateBody}>
            Find cards, decks, and community decks in one place.
          </Text>
        </View>
      ) : loading && !results ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <FeaturedIcon icon="warning" variant="gray" size="lg" />
          <Text style={styles.stateTitle}>Search failed</Text>
          <Text style={styles.stateBody}>{error}</Text>
        </View>
      ) : grouped.length === 0 ? (
        <View style={styles.stateBox}>
          <FeaturedIcon icon="search" variant="gray" size="lg" />
          <Text style={styles.stateTitle}>No results</Text>
          <Text style={styles.stateBody}>
            Nothing matched “{query.trim()}”. Try a different search.
          </Text>
        </View>
      ) : (
        grouped.map((section) => (
          <View key={section.kind} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.label}</Text>
            <View>
              {section.hits.map((hit, index) => (
                <Pressable
                  key={`${hit.kind}-${hit.id}`}
                  onPress={() => navigateToHit(hit)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Icon
                    name={section.icon}
                    size={18}
                    color={colors.fgTertiary}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {hit.title}
                    </Text>
                    {hit.subtitle ? (
                      <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {hit.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Icon
                    name="arrowRightSmall"
                    size={16}
                    color={colors.fgTertiary}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { padding: 16, gap: 20, paddingBottom: 40 },
    stateBox: { alignItems: "center", paddingTop: 56, gap: 4 },
    stateTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    stateBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    section: { gap: 2 },
    sectionTitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingVertical: 10,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    // Overhangs only while pressed, so the hairlines stay aligned with the text.
    rowPressed: {
      backgroundColor: colors.bgHover,
      marginHorizontal: -8,
      paddingHorizontal: 8,
    },
    rowText: { flex: 1, minWidth: 0, gap: 1 },
    rowTitle: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    rowSubtitle: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
  });
}
