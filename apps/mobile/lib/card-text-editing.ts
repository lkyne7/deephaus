import type { ImageOcclusionData } from "@deephaus/shared";

/** Cloze ids the keyboard toolbar offers; the editor itself allows the same range. */
export const MAX_CLOZE_ID = 7;

export const CLOZE_IDS = Array.from(
  { length: MAX_CLOZE_ID },
  (_, index) => `c${index + 1}`,
) as readonly string[];

export type CardType = "basic" | "cloze" | "image-occlusion";

export type CardUpdateFields = {
  type: CardType;
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  occlusion_data?: ImageOcclusionData | null;
  tags?: string[];
};

export function buildCardUpdateBody(fields: CardUpdateFields): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: fields.type,
    front: fields.front ?? null,
    back:
      fields.type === "basic"
        ? fields.back ?? fields.extra ?? null
        : fields.back ?? null,
    cloze_text: fields.type === "cloze" ? fields.cloze_text ?? null : null,
    // Basic and image-occlusion cards can carry imported explanatory content
    // in extra even though the editor does not expose a separate field.
    extra: fields.extra ?? null,
    occlusion_data:
      fields.type === "image-occlusion" ? (fields.occlusion_data ?? null) : null,
  };
  if (fields.tags !== undefined) {
    body.tags = fields.tags;
  }
  return body;
}

export function cardUpdateSnapshot(fields: CardUpdateFields): string {
  return JSON.stringify(buildCardUpdateBody(fields));
}

export function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}
