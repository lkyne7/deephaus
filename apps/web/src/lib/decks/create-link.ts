import {
  DETAIL_LEVEL_OPTIONS,
  FOCUS_PRESET_OPTIONS,
  type DetailLevel,
  type FocusPreset,
} from "@deephaus/shared";

export type CreateComposerParams = {
  detail?: DetailLevel;
  focus?: FocusPreset;
  intent?: "edit" | "generate";
};

/** Link into the Create chat for a deck, carrying what was set on the deck page. */
export function deckCreateHref(
  deckId: string,
  { prompt, detail, focus, intent }: CreateComposerParams & { prompt?: string } = {},
): string {
  const params = new URLSearchParams({ deck: deckId });
  const text = prompt?.trim();
  if (text) params.set("prompt", text);
  if (detail) params.set("detail", detail);
  if (focus) params.set("focus", focus);
  if (intent) params.set("intent", intent);
  return `/create?${params}`;
}

export function parseCreateParams(raw: {
  detail?: string;
  focus?: string;
  intent?: string;
}): CreateComposerParams {
  const detail = DETAIL_LEVEL_OPTIONS.find((option) => option.value === raw.detail)?.value;
  const focus = FOCUS_PRESET_OPTIONS.find((option) => option.value === raw.focus)?.value;
  const intent = raw.intent === "edit" || raw.intent === "generate" ? raw.intent : undefined;
  return { detail, focus, intent };
}
