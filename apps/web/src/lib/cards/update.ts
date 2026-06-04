import type { ImageOcclusionData } from "@deephaus/shared";

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
    extra: fields.type === "cloze" ? fields.extra ?? null : null,
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

export async function updateCardApi<T = unknown>(
  cardId: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/cards/${cardId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
