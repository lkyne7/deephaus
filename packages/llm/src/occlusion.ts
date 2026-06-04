import { createOcclusionRectId, type OcclusionRect } from "@deephaus/shared";

type DetectOptions = {
  apiKey: string;
  model?: string;
};

const detectResponseSchema = {
  type: "object",
  properties: {
    rects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          label: { type: "string" },
        },
        // OpenAI strict structured outputs require every property to be listed
        // in `required` (optional keys are not allowed). `label` may be empty.
        required: ["x", "y", "width", "height", "label"],
        additionalProperties: false,
      },
    },
  },
  required: ["rects"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT =
  "You label study regions on educational images to build image-occlusion flashcards, " +
  "the same way Anki Image Occlusion works. The image is often an anatomy or biology " +
  "diagram with printed text labels and leader lines pointing at structures. " +
  "Return a tight bounding box around each printed LABEL/CALLOUT text (the word or phrase " +
  "naming a part), NOT the whole structure — hiding the box should quiz the student on " +
  "recalling that label. If the image is a plain list/table of terms, box each term. " +
  "Put the exact label text in the `label` field for every box. " +
  "Use normalized coordinates from 0 to 1 where (x, y) is the top-left corner of the box, " +
  "and width/height are fractions of the image. Prefer 3–20 non-overlapping, axis-aligned " +
  "boxes. Skip slide titles, headings, page numbers, citations, emails, watermarks, logos, " +
  "and decorative backgrounds. If there is nothing useful to occlude, return an empty list.";

/**
 * Use a vision model to propose normalized occlusion rectangles over an image.
 * Returns an empty array when the model finds nothing useful.
 */
export async function detectOcclusionRects(
  imageUrl: string,
  opts: DetectOptions,
): Promise<OcclusionRect[]> {
  const model = opts.model ?? "gpt-4o";
  // o-series reasoning models (o1, o3, o4-mini, …) reject `temperature` values
  // other than the default, so only send it for standard chat models.
  const isReasoningModel = /^o\d/i.test(model);

  const body: Record<string, unknown> = {
    model,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "occlusion_regions",
        strict: true,
        schema: detectResponseSchema,
      },
    },
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Detect occlusion regions for this flashcard image. Return JSON only.",
          },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
  };
  if (!isReasoningModel) body.temperature = 0.2;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Vision API error (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return [];

  const parsed = JSON.parse(content) as {
    rects?: Array<{ x: number; y: number; width: number; height: number; label?: string }>;
  };

  return (parsed.rects ?? []).map((rect) => ({
    id: createOcclusionRectId(),
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    label: rect.label,
    enabled: true,
  }));
}

/** Deterministic mock regions for dev without an API key. */
export function mockOcclusionRects(): OcclusionRect[] {
  const boxes = [
    { x: 0.08, y: 0.12, width: 0.35, height: 0.18, label: "Region A" },
    { x: 0.55, y: 0.1, width: 0.32, height: 0.2, label: "Region B" },
    { x: 0.15, y: 0.45, width: 0.4, height: 0.22, label: "Region C" },
    { x: 0.5, y: 0.5, width: 0.38, height: 0.25, label: "Region D" },
  ];
  return boxes.map((box) => ({ ...box, id: createOcclusionRectId(), enabled: true }));
}
