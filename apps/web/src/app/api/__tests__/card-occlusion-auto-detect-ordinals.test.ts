import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createClient, detectOcclusionRectsByOcr, reconcile } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  detectOcclusionRectsByOcr: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/billing/access", () => ({
  requirePlan: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/occlusion/ocr", () => ({ detectOcclusionRectsByOcr }));
vi.mock("@/lib/occlusion/reconcile-reviews", () => ({
  reconcileOcclusionStudyReviews: reconcile,
}));

import { POST } from "@/app/api/cards/[id]/occlusion/auto-detect/route";

const SUPABASE_URL = "https://project.supabase.co";
const IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/card-media/user-1/diagram.png`;
const params = { params: Promise.resolve({ id: "card-1" }) };

function region(index: number) {
  return {
    id: `region-${index}`,
    x: 0.05,
    y: Math.min(0.9, index * 0.07),
    width: 0.2,
    height: 0.05,
    label: `Label ${index}`,
    enabled: true,
  };
}

function cardsTable() {
  const updates: Array<Record<string, unknown>> = [];
  const card = {
    id: "card-1",
    type: "basic",
    front: `<img src="${IMAGE_URL}">`,
    back: null,
    cloze_text: null,
    extra: null,
    occlusion_data: null,
  };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) query[method] = vi.fn(() => query);
  query.update = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    return query;
  });
  query.single = vi.fn(async () =>
    updates.length > 0
      ? { data: { occlusion_data: updates[0].occlusion_data, type: "image-occlusion" }, error: null }
      : { data: card, error: null },
  );
  return { query, updates };
}

describe("POST /api/cards/[id]/occlusion/auto-detect ordinals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives each detected region its own cloze group, capped at C9", async () => {
    detectOcclusionRectsByOcr.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => region(i + 1)),
    );
    const { query, updates } = cardsTable();
    createClient.mockResolvedValue({ from: vi.fn(() => query) });

    const response = await POST(new Request("https://app.test", { method: "POST" }), params);
    expect(response.status).toBe(200);
    const body = await response.json();

    const ords = body.occlusion_data.rects.map((rect: { ord: number }) => rect.ord);
    expect(ords).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(body.added).toBe(9);
    expect(updates[0].occlusion_data).toEqual(body.occlusion_data);
    expect(reconcile).toHaveBeenCalledWith(
      expect.anything(),
      "card-1",
      "user-1",
      body.occlusion_data,
    );
  });
});
