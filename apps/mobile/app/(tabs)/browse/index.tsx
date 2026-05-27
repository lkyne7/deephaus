import type { BrowseCardRow, BrowseFilters } from "@deephaus/api-client";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RichCardContent } from "@/components/rich-card-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MutedText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";

export default function BrowseScreen() {
  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [filters, setFilters] = useState<BrowseFilters | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [deckId, setDeckId] = useState<string | undefined>();
  const [tag, setTag] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    setLoading(!append);
    try {
      const result = await api.browseCards({
        deck_id: deckId,
        tag,
        q: search || undefined,
        limit: 50,
        offset: nextOffset,
        filters: nextOffset === 0,
      });
      setCards((prev) => (append ? [...prev, ...result.cards] : result.cards));
      setTotal(result.total);
      setOffset(nextOffset);
      if (result.filters) setFilters(result.filters);
    } catch {
      if (!append) setCards([]);
    } finally {
      setLoading(false);
    }
  }, [deckId, tag, search]);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function batchAction(action: "suspend" | "unsuspend" | "delete") {
    if (selected.size === 0) return;
    await api.browseBatch({ action, card_ids: Array.from(selected) });
    setSelected(new Set());
    await load(0, false);
  }

  return (
    <View style={styles.container}>
      <Input placeholder="Search cards" value={search} onChangeText={setSearch} onSubmitEditing={() => void load(0, false)} />
      {filters && (
        <View style={styles.filterRow}>
          <Pressable style={[styles.filterChip, !deckId && styles.filterActive]} onPress={() => setDeckId(undefined)}>
            <Text style={styles.filterText}>All decks</Text>
          </Pressable>
          {filters.decks.map((deck) => (
            <Pressable
              key={deck.id}
              style={[styles.filterChip, deckId === deck.id && styles.filterActive]}
              onPress={() => setDeckId(deck.id)}
            >
              <Text style={styles.filterText}>{deck.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {filters && filters.tags.length > 0 && (
        <View style={styles.filterRow}>
          <Pressable style={[styles.filterChip, !tag && styles.filterActive]} onPress={() => setTag(undefined)}>
            <Text style={styles.filterText}>All tags</Text>
          </Pressable>
          {filters.tags.slice(0, 8).map((t) => (
            <Pressable
              key={t}
              style={[styles.filterChip, tag === t && styles.filterActive]}
              onPress={() => setTag(t)}
            >
              <Text style={styles.filterText}>{t}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {selected.size > 0 && (
        <View style={styles.batchRow}>
          <Button label={`Suspend (${selected.size})`} variant="secondary" onPress={() => void batchAction("suspend")} />
          <Button label="Unsuspend" variant="secondary" onPress={() => void batchAction("unsuspend")} />
          <Button label="Delete" variant="danger" onPress={() => void batchAction("delete")} />
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
          onEndReached={() => {
            if (cards.length < total) void load(offset + 50, true);
          }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/(tabs)/browse/${item.id}`)}
              onLongPress={() => toggleSelect(item.id)}
            >
              <Card style={[styles.card, selected.has(item.id) && styles.selected, item.suspended && styles.suspended]}>
                <Text style={styles.meta}>
                  {item.deck_name} · {item.type}
                  {item.suspended ? " · suspended" : ""}
                </Text>
                <RichCardContent
                  content={item.type === "basic" ? item.front : item.cloze_text}
                  style={{ minHeight: 40 }}
                />
              </Card>
            </Pressable>
          )}
          ListEmptyComponent={<MutedText style={styles.empty}>No cards found.</MutedText>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 16, gap: 8 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.surface,
  },
  filterActive: { borderColor: theme.colors.accent, backgroundColor: "rgba(91,159,212,0.15)" },
  filterText: { color: theme.colors.text, fontSize: 12 },
  batchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { gap: 8 },
  selected: { borderColor: theme.colors.accent },
  suspended: { opacity: 0.6 },
  meta: { color: theme.colors.muted, fontSize: 12 },
  empty: { textAlign: "center", marginTop: 24 },
});
