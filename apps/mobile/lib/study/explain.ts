import { generateUuid } from "@deephaus/local-db";
import type { CardExplainKind, CardExplainState } from "@deephaus/api-client";
import { api } from "@/lib/api";
import { getCachedNetworkState } from "@/lib/network-state";
import { offlineData } from "@/lib/offline-data";

/** Card fields Hint and Explain need on the phone. */
export type ExplainCard = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  cloze_ord?: number | null;
};

export function hasExplainContent(state: CardExplainState | null, kind: CardExplainKind): boolean {
  if (!state) return false;
  return kind === "explain" ? !!state.explanation : state.hints.length > 0;
}

/** A message for a failed Hint/Explain request, in the app's voice. */
export async function explainErrorMessage(error: unknown, action: "write" | "ask"): Promise<string> {
  const status = (error as { status?: number } | null)?.status;
  if (status === 402) return "You're out of AI credits for now.";
  const network = await getCachedNetworkState();
  if (network.isConnected === false || network.isInternetReachable === false) {
    return action === "ask" ? "Questions need a connection." : "Writing a new one needs a connection.";
  }
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

/** The saved result, readable offline once synced. Null when nothing could be read. */
export async function readSavedExplanation(
  card: ExplainCard,
  kind: CardExplainKind,
): Promise<CardExplainState | null> {
  try {
    return await offlineData.getCardExplanation(card.id, { kind, clozeOrd: card.cloze_ord ?? null });
  } catch {
    return null;
  }
}

/** Writes a new Hint/Explain result for 1 credit (or returns the saved one). */
export function writeExplanation(card: ExplainCard, kind: CardExplainKind, rewrite = false) {
  return api.explainCard(card.id, { kind, clozeOrd: card.cloze_ord ?? null, rewrite }, generateUuid());
}

export function askAboutCard(card: ExplainCard, message: string) {
  return api.askAboutCard(card.id, message, generateUuid());
}

/** A short, plain label for a card's answer, for the missed-card pill. */
export function missedAnswerLabel(card: ExplainCard): string {
  let text = "";
  if (card.type === "cloze" && card.cloze_text) {
    text = [...card.cloze_text.matchAll(/\{\{c(\d+)::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g)]
      .filter((m) => !card.cloze_ord || Number(m[1]) === card.cloze_ord)
      .map((m) => m[2])
      .join(", ");
  } else {
    text = card.back || card.extra || card.front || "";
  }
  const plain = text.replace(/<[^>]+>/g, " ").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 48 ? `${plain.slice(0, 45).trimEnd()}…` : plain || "this card";
}
