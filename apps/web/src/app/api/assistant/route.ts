import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collectionOverview,
  createMockCollectionOverview,
  createMockCritique,
  createMockDeckSummary,
  createMockFocusPrompt,
  createMockHint,
  createMockMnemonic,
  createMockRecommendDecks,
  createMockStatsInsights,
  createMockStudyPlan,
  createMockWeakSpots,
  critiqueCard,
  deckWeakSpots,
  hintForCard,
  mnemonicForCard,
  recommendDecks,
  statsInsights,
  studyPlan,
  suggestFocusPrompt,
  summarizeDeck,
  type CardExplainInput,
  type LlmConfig,
  type StudyPlanDeck,
  type WeakSpotCard,
} from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadDashboardMetricsBundle } from "@/lib/fsrs/dashboard-metrics";
import { loadCommunityDecks } from "@/lib/community/load-community-decks";

const cardSchema = z.object({
  id: z.string().uuid().nullish(),
  type: z.string(),
  front: z.string().nullish(),
  back: z.string().nullish(),
  cloze_text: z.string().nullish(),
  extra: z.string().nullish(),
});

const bodySchema = z.object({
  action: z.enum([
    "hint-card",
    "mnemonic-card",
    "critique-card",
    "summarize-deck",
    "deck-weak-spots",
    "deck-study-plan",
    "stats-insights",
    "study-today",
    "collection-overview",
    "suggest-focus",
    "recommend-decks",
  ]),
  deck_id: z.string().uuid().optional(),
  card_id: z.string().uuid().optional(),
  payload: z
    .object({
      card: cardSchema.optional(),
      source_text: z.string().max(20000).optional(),
    })
    .optional(),
});

const USE_MOCK = () =>
  process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY;

function llmConfig(): LlmConfig {
  return { apiKey: process.env.OPENAI_API_KEY ?? "" };
}

/** Strip HTML tags + collapse whitespace for prompt-friendly card text. */
function cleanText(value: string | null | undefined, max = 160): string {
  if (!value) return "";
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{c\d+::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g, "[$1]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function cardPrompt(card: { type: string; front?: string | null; cloze_text?: string | null }): string {
  return card.type === "cloze" ? cleanText(card.cloze_text) : cleanText(card.front);
}

async function fetchOwnedCard(
  supabase: SupabaseClient,
  cardId: string,
  userId: string,
): Promise<CardExplainInput | null> {
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, generation_jobs!inner(sources!inner(projects!inner(user_id)))",
    )
    .eq("id", cardId)
    .eq("generation_jobs.sources.projects.user_id", userId)
    .single();

  if (error || !data) return null;
  return {
    type: data.type as "basic" | "cloze",
    front: data.front,
    back: data.back,
    cloze_text: data.cloze_text,
    extra: data.extra,
  };
}

async function fetchOwnedDeck(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, deck_name")
    .eq("id", deckId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return { id: data.id, name: data.deck_name || data.name };
}

async function fetchDeckCardSamples(
  supabase: SupabaseClient,
  deckId: string,
): Promise<{ samples: string[]; tags: string[]; count: number }> {
  const { data, error } = await supabase
    .from("cards")
    .select("type, front, cloze_text, tags, generation_jobs!inner(sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", deckId)
    .limit(60);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    type: string;
    front: string | null;
    cloze_text: string | null;
    tags: string[] | null;
  }>;

  const tagSet = new Set<string>();
  const samples: string[] = [];
  for (const row of rows) {
    const prompt = cardPrompt(row);
    if (prompt && samples.length < 40) samples.push(prompt);
    for (const tag of row.tags ?? []) tagSet.add(tag);
  }

  return { samples, tags: [...tagSet].slice(0, 20), count: rows.length };
}

async function fetchWeakCards(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
): Promise<WeakSpotCard[]> {
  const { data, error } = await supabase
    .from("card_reviews")
    .select(
      `lapses, reps, stability,
      cards!inner ( type, front, cloze_text, generation_jobs!inner ( sources!inner ( project_id ) ) )`,
    )
    .eq("user_id", userId)
    .eq("cards.generation_jobs.sources.project_id", deckId)
    .gt("lapses", 0)
    .order("lapses", { ascending: false })
    .limit(12);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown[]).flatMap((raw) => {
    const row = raw as {
      lapses: number;
      reps: number;
      stability: number | null;
      cards: { type: string; front: string | null; cloze_text: string | null } | Array<{
        type: string;
        front: string | null;
        cloze_text: string | null;
      }>;
    };
    const card = Array.isArray(row.cards) ? row.cards[0] : row.cards;
    if (!card) return [];
    const prompt = cardPrompt(card);
    if (!prompt) return [];
    return [{ prompt, lapses: row.lapses, reps: row.reps, stability: row.stability }];
  });
}

function toPlanDecks(
  perDeck: Array<{ name: string; due: number; new: number; total: number }>,
): StudyPlanDeck[] {
  return perDeck.map((d) => ({
    name: d.name,
    due: d.due,
    newCards: d.new,
    total: d.total,
  }));
}

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const userId = user!.id;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { action, deck_id, card_id, payload } = parsed;
  const supabase = await createClient();
  const useMock = USE_MOCK();
  const config = llmConfig();

  try {
    switch (action) {
      case "hint-card":
      case "mnemonic-card":
      case "critique-card": {
        let card: CardExplainInput | null = null;
        if (card_id) card = await fetchOwnedCard(supabase, card_id, userId);
        if (!card && payload?.card) card = payload.card as CardExplainInput;
        if (!card) {
          return NextResponse.json({ error: "Card not found" }, { status: 404 });
        }

        const markdown =
          action === "hint-card"
            ? useMock
              ? createMockHint(card)
              : await hintForCard(card, config)
            : action === "mnemonic-card"
              ? useMock
                ? createMockMnemonic(card)
                : await mnemonicForCard(card, config)
              : useMock
                ? createMockCritique(card)
                : await critiqueCard(card, config);

        return NextResponse.json({ markdown });
      }

      case "summarize-deck": {
        if (!deck_id) return NextResponse.json({ error: "deck_id required" }, { status: 400 });
        const deck = await fetchOwnedDeck(supabase, deck_id, userId);
        if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

        const { samples, tags, count } = await fetchDeckCardSamples(supabase, deck_id);
        if (!samples.length) {
          return NextResponse.json({
            markdown: `**${deck.name}** has no cards yet — generate or import some first.`,
          });
        }

        const input = { deckName: deck.name, cardCount: count, sampleCards: samples, tags };
        const markdown = useMock
          ? createMockDeckSummary(input)
          : await summarizeDeck(input, config);
        return NextResponse.json({ markdown });
      }

      case "deck-weak-spots": {
        if (!deck_id) return NextResponse.json({ error: "deck_id required" }, { status: 400 });
        const deck = await fetchOwnedDeck(supabase, deck_id, userId);
        if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

        const weakCards = await fetchWeakCards(supabase, deck_id, userId);
        const input = { deckName: deck.name, weakCards };
        const markdown = useMock
          ? createMockWeakSpots(input)
          : await deckWeakSpots(input, config);
        return NextResponse.json({ markdown });
      }

      case "deck-study-plan":
      case "study-today":
      case "stats-insights": {
        const bundle = await loadDashboardMetricsBundle(supabase, userId);
        let decks = toPlanDecks(bundle.perDeck);

        if (action === "deck-study-plan") {
          if (!deck_id) return NextResponse.json({ error: "deck_id required" }, { status: 400 });
          const deck = await fetchOwnedDeck(supabase, deck_id, userId);
          if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
          decks = toPlanDecks(bundle.perDeck.filter((d) => d.deck_id === deck_id));
          if (!decks.length) decks = [{ name: deck.name, due: 0, newCards: 0, total: 0 }];
        }

        if (action === "stats-insights") {
          const input = {
            totalCards: bundle.totalCards,
            stateBreakdown: {
              newCards: bundle.stateBreakdown.new,
              learning: bundle.stateBreakdown.learning + bundle.stateBreakdown.relearning,
              review: bundle.stateBreakdown.review,
            },
            decks,
          };
          const markdown = useMock
            ? createMockStatsInsights(input)
            : await statsInsights(input, config);
          return NextResponse.json({ markdown });
        }

        if (!decks.length) {
          return NextResponse.json({
            markdown: "You don't have any decks yet — create one to get a study plan.",
          });
        }

        const input = { decks, scope: (action === "deck-study-plan" ? "deck" : "all") as "deck" | "all" };
        const markdown = useMock ? createMockStudyPlan(input) : await studyPlan(input, config);
        return NextResponse.json({ markdown });
      }

      case "collection-overview": {
        const bundle = await loadDashboardMetricsBundle(supabase, userId);

        const { data: cardRows, error } = await supabase
          .from("cards")
          .select("type, tags, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
          .eq("generation_jobs.sources.projects.user_id", userId)
          .limit(1000);
        if (error) throw new Error(error.message);

        const typeCounts: Record<string, number> = {};
        const tagCounts = new Map<string, number>();
        for (const raw of (cardRows ?? []) as Array<{ type: string; tags: string[] | null }>) {
          typeCounts[raw.type] = (typeCounts[raw.type] ?? 0) + 1;
          for (const tag of raw.tags ?? []) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
        const topTags = [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([tag, count]) => ({ tag, count }));

        const input = { decks: toPlanDecks(bundle.perDeck), typeCounts, topTags };
        const markdown = useMock
          ? createMockCollectionOverview(input)
          : await collectionOverview(input, config);
        return NextResponse.json({ markdown });
      }

      case "suggest-focus": {
        const sourceText = payload?.source_text ?? "";
        const markdown = useMock
          ? createMockFocusPrompt(sourceText)
          : await suggestFocusPrompt(sourceText, config);
        return NextResponse.json({ markdown });
      }

      case "recommend-decks": {
        const [communityRows, { data: projects }] = await Promise.all([
          loadCommunityDecks(supabase, userId),
          supabase.from("projects").select("name, deck_name").eq("user_id", userId),
        ]);

        const input = {
          myDeckNames: (projects ?? []).map(
            (p: { name: string; deck_name: string | null }) => p.deck_name || p.name,
          ),
          communityDecks: communityRows
            .filter((d) => !d.is_owner)
            .slice(0, 25)
            .map((d) => ({
              title: d.title,
              description: d.description,
              cardCount: d.card_count,
            })),
        };

        const markdown = useMock
          ? createMockRecommendDecks(input)
          : await recommendDecks(input, config);
        return NextResponse.json({ markdown });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assistant request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/assistant");
