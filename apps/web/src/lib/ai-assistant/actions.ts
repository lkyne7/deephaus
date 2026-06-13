import type { AiPageContext } from "./context";

export type AiActionId =
  | "explain-card"
  | "hint-card"
  | "mnemonic-card"
  | "summarize-deck"
  | "deck-weak-spots"
  | "deck-study-plan"
  | "stats-insights"
  | "study-today"
  | "collection-overview"
  | "critique-card"
  | "suggest-focus"
  | "recommend-decks";

export type AiActionDef = {
  id: AiActionId;
  label: string;
  description: string;
  icon: string;
};

const ACTIONS: Record<AiActionId, AiActionDef> = {
  "explain-card": {
    id: "explain-card",
    label: "Explain this card",
    description: "A deeper explanation of the concept",
    icon: "ri-lightbulb-line",
  },
  "hint-card": {
    id: "hint-card",
    label: "Give me a hint",
    description: "A nudge without revealing the answer",
    icon: "ri-question-line",
  },
  "mnemonic-card": {
    id: "mnemonic-card",
    label: "Make a mnemonic",
    description: "A memory aid for this card",
    icon: "ri-brain-line",
  },
  "summarize-deck": {
    id: "summarize-deck",
    label: "Summarize deck topics",
    description: "What this deck covers at a glance",
    icon: "ri-file-list-3-line",
  },
  "deck-weak-spots": {
    id: "deck-weak-spots",
    label: "Find my weak spots",
    description: "Cards you lapse on most",
    icon: "ri-focus-3-line",
  },
  "deck-study-plan": {
    id: "deck-study-plan",
    label: "Suggest a study plan",
    description: "How to tackle this deck",
    icon: "ri-calendar-todo-line",
  },
  "stats-insights": {
    id: "stats-insights",
    label: "Analyze my stats",
    description: "Insights from your review history",
    icon: "ri-line-chart-line",
  },
  "study-today": {
    id: "study-today",
    label: "What should I study today?",
    description: "Prioritized by due and new cards",
    icon: "ri-compass-3-line",
  },
  "collection-overview": {
    id: "collection-overview",
    label: "Collection overview",
    description: "Insights across all your cards",
    icon: "ri-archive-stack-line",
  },
  "critique-card": {
    id: "critique-card",
    label: "Critique current card",
    description: "Feedback on card quality",
    icon: "ri-edit-circle-line",
  },
  "suggest-focus": {
    id: "suggest-focus",
    label: "Suggest a focus prompt",
    description: "Based on your source text",
    icon: "ri-crosshair-2-line",
  },
  "recommend-decks": {
    id: "recommend-decks",
    label: "Recommend decks for me",
    description: "Community decks that fit your collection",
    icon: "ri-community-line",
  },
};

export function actionsForContext(ctx: AiPageContext): AiActionDef[] {
  switch (ctx.page) {
    case "study-card":
      return [ACTIONS["explain-card"], ACTIONS["hint-card"], ACTIONS["mnemonic-card"]];
    case "deck":
      return [ACTIONS["summarize-deck"], ACTIONS["deck-weak-spots"], ACTIONS["deck-study-plan"]];
    case "dashboard":
      return [ACTIONS["stats-insights"], ACTIONS["study-today"]];
    case "decks-list":
      return [ACTIONS["study-today"]];
    case "browse":
      return [ACTIONS["collection-overview"]];
    case "create": {
      const items = [ACTIONS["suggest-focus"]];
      if (ctx.card) items.unshift(ACTIONS["critique-card"]);
      return items;
    }
    case "community":
      return [ACTIONS["recommend-decks"]];
  }
}
