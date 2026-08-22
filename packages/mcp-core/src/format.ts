import type { BrowseCardRow, ReviewCardPayload } from "@deephaus/api-client";

export function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function presentQueueCard(
  card: ReviewCardPayload,
  includeAnswers: boolean,
): Record<string, unknown> {
  const base = {
    id: card.id,
    queue_key: card.queue_key,
    cloze_ord: card.cloze_ord,
    type: card.type,
    tags: card.tags,
    state: card.state,
    due: card.due,
    reps: card.reps,
    lapses: card.lapses,
    is_new: card.is_new,
    intervals: card.intervals,
  };

  if (card.type === "basic") {
    return {
      ...base,
      front: stripHtml(card.front),
      ...(includeAnswers ? { back: stripHtml(card.back), extra: stripHtml(card.extra) } : {}),
    };
  }

  if (card.type === "cloze") {
    const text = includeAnswers ? card.cloze_text : maskClozeAnswers(card.cloze_text);
    return {
      ...base,
      cloze_text: stripHtml(text),
      ...(includeAnswers ? { extra: stripHtml(card.extra) } : {}),
    };
  }

  return {
    ...base,
    front: stripHtml(card.front),
    ...(includeAnswers ? { back: stripHtml(card.back), occlusion_data: card.occlusion_data } : {}),
  };
}

export function presentBrowseCard(card: BrowseCardRow): Record<string, unknown> {
  return {
    id: card.id,
    deck_id: card.deck_id,
    deck_name: card.deck_name,
    type: card.type,
    front: stripHtml(card.front),
    back: stripHtml(card.back),
    cloze_text: stripHtml(card.cloze_text),
    extra: stripHtml(card.extra),
    tags: card.tags,
    suspended: card.suspended,
  };
}

function maskClozeAnswers(clozeText: string | null): string | null {
  if (!clozeText) return clozeText;
  return clozeText.replace(/\{\{c(\d+)::([^:}]+)(?:::([^}]+))?\}\}/g, "{{c$1::...}}");
}
