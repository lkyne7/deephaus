/** Curated topics users can pick to auto-generate flashcards from model knowledge. */
export type TopicPreset = {
  id: string;
  label: string;
  /** Full prompt sent to the generator (may be richer than the chip label). */
  query: string;
  category: string;
};

export const TOPIC_PRESET_CATEGORIES = [
  "Medicine",
  "Geography",
  "Science",
  "History",
  "Languages",
  "General",
] as const;

export type TopicPresetCategory = (typeof TOPIC_PRESET_CATEGORIES)[number];

export const TOPIC_GENERATION_PRESETS: TopicPreset[] = [
  {
    id: "heart-failure",
    label: "Heart failure guidelines",
    query: "Heart failure diagnosis and management guidelines (symptoms, staging, key treatments)",
    category: "Medicine",
  },
  {
    id: "ecg-basics",
    label: "ECG basics",
    query: "ECG interpretation basics (waves, intervals, common arrhythmias)",
    category: "Medicine",
  },
  {
    id: "pharmacology",
    label: "High-yield pharmacology",
    query: "High-yield pharmacology drug classes, mechanisms, and side effects",
    category: "Medicine",
  },
  {
    id: "world-flags",
    label: "Flags of the world",
    query: "Flags of the world — country names and distinguishing flag features",
    category: "Geography",
  },
  {
    id: "us-capitals",
    label: "US state capitals",
    query: "US state capitals and their states",
    category: "Geography",
  },
  {
    id: "europe-countries",
    label: "European countries",
    query: "European countries, capitals, and quick geographic facts",
    category: "Geography",
  },
  {
    id: "organic-chem",
    label: "Organic chemistry",
    query: "Organic chemistry reactions, functional groups, and named mechanisms",
    category: "Science",
  },
  {
    id: "cell-bio",
    label: "Cell biology",
    query: "Cell biology — organelles, membrane transport, and cell cycle",
    category: "Science",
  },
  {
    id: "physics-formulas",
    label: "Physics formulas",
    query: "Essential physics formulas (mechanics, electricity, waves) with variables explained",
    category: "Science",
  },
  {
    id: "ww2",
    label: "World War II",
    query: "World War II key events, leaders, battles, and dates",
    category: "History",
  },
  {
    id: "ancient-rome",
    label: "Ancient Rome",
    query: "Ancient Rome — emperors, institutions, and major events",
    category: "History",
  },
  {
    id: "spanish-verbs",
    label: "Spanish common verbs",
    query: "Most common Spanish verbs with present-tense conjugations and meanings",
    category: "Languages",
  },
  {
    id: "french-a1",
    label: "French A1 vocabulary",
    query: "French A1 vocabulary — everyday nouns, verbs, and phrases",
    category: "Languages",
  },
  {
    id: "periodic-table",
    label: "Periodic table trends",
    query: "Periodic table element groups, trends, and common element facts",
    category: "General",
  },
  {
    id: "accounting",
    label: "Accounting basics",
    query: "Accounting basics — financial statements, debits/credits, key ratios",
    category: "General",
  },
];

/** Target card count when generating from a topic alone (no source word count). */
export const TOPIC_DETAIL_LEVEL_CARD_COUNT = {
  low: 8,
  medium: 15,
  high: 25,
} as const;

/** Stored on text sources when the DB has not yet migrated to type `topic`. */
export const TOPIC_SOURCE_PREFIX = "[[deephaus:topic]]\n";

export function isTopicSource(source: { type: string; raw_text?: string | null }): boolean {
  return source.type === "topic" || Boolean(parseTopicFromSource(source.raw_text));
}

export function topicQueryFromSource(source: { type: string; raw_text?: string | null }): string {
  if (source.type === "topic") return source.raw_text?.trim() ?? "";
  return parseTopicFromSource(source.raw_text) ?? "";
}

export function formatTopicSourceText(topic: string): string {
  return `${TOPIC_SOURCE_PREFIX}${topic.trim()}`;
}

function parseTopicFromSource(rawText: string | null | undefined): string | null {
  if (!rawText?.startsWith(TOPIC_SOURCE_PREFIX)) return null;
  const topic = rawText.slice(TOPIC_SOURCE_PREFIX.length).trim();
  return topic || null;
}
