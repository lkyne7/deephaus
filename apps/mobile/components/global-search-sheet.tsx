import type { GlobalSearchHit, GlobalSearchKind, GlobalSearchResponse } from "@deephaus/api-client";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { GlassSurface, liquidGlassAvailable } from "@/components/ui/glass-surface";
import { Field } from "@/components/ui/input";
import { Icon, type IconName } from "@/components/ui/icon";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const SECTIONS: Array<{ kind: GlobalSearchKind; label: string; icon: IconName }> = [
  { kind: "card", label: "Cards", icon: "layers" },
  { kind: "deck", label: "Decks", icon: "book" },
  { kind: "community", label: "Community", icon: "community" },
];

function navigateToHit(hit: GlobalSearchHit) {
  if (hit.kind === "card") {
    router.push(`/(tabs)/browse/${hit.id}`);
    return;
  }
  if (hit.kind === "deck") {
    router.push({ pathname: "/(tabs)/browse", params: { deck: hit.id } });
    return;
  }
  if (hit.kind === "community") {
    router.push({ pathname: "/(tabs)/community", params: { q: hit.title } });
  }
}

export function GlobalSearchSheet({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults(null);
      setError(null);
      setLoading(false);
    }
  }, [visible]);

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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <GlassSurface
          fallbackColor={colors.bgSurface}
          glassEffectStyle="regular"
          style={styles.header}
        >
          <View style={{ flex: 1 }}>
            <Field
              leadingIcon="search"
              placeholder="Search decks, cards, community…"
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              trailing={
                query ? (
                  <Pressable onPress={() => setQuery("")} hitSlop={6}>
                    <Icon name="close" size={16} color={colors.fgQuaternary} />
                  </Pressable>
                ) : null
              }
            />
          </View>
          <Button
            variant="tertiary"
            size="sm"
            pill
            label="Cancel"
            onPress={onClose}
          />
        </GlassSurface>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
              <ActivityIndicator color={colors.brand500} />
            </View>
          ) : error ? (
            <View style={styles.stateBox}>
              <FeaturedIcon icon="warning" variant="orange" size="lg" />
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
                <View style={styles.sectionRows}>
                  {section.hits.map((hit) => (
                    <Pressable
                      key={`${hit.kind}-${hit.id}`}
                      onPress={() => {
                        onClose();
                        navigateToHit(hit);
                      }}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.rowIcon}>
                        <Icon name={section.icon} size={16} color={colors.fgTertiary} />
                      </View>
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
                      <Icon name="arrowRightSmall" size={16} color={colors.fgQuaternary} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12,
      backgroundColor: "transparent",
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: liquidGlassAvailable ? 0 : 1,
    },
    content: {
      padding: 16,
      gap: 16,
      paddingBottom: 40,
    },
    stateBox: {
      alignItems: "center",
      paddingTop: 56,
      gap: 4,
    },
    stateTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    stateBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    section: {
      gap: 8,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgQuaternary,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      paddingHorizontal: 4,
    },
    sectionRows: {
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderTertiary,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      backgroundColor: colors.gray50,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    rowTitle: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    rowSubtitle: {
      fontSize: 12,
      color: colors.fgTertiary,
    },
  });
}
