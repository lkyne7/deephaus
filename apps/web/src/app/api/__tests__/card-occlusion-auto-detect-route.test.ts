import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCardMediaUrlOnOrigin } from "@deephaus/shared";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createClient, detectOcclusionRectsByOcr, reconcileOcclusionStudyReviews } =
  vi.hoisted(() => ({
    requireUser: vi.fn(),
    createClient: vi.fn(),
    detectOcclusionRectsByOcr: vi.fn(),
    reconcileOcclusionStudyReviews: vi.fn(),
  }));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/billing/access", () => ({
  requirePlan: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/occlusion/ocr", () => ({ detectOcclusionRectsByOcr }));
vi.mock("@/lib/occlusion/reconcile-reviews", () => ({ reconcileOcclusionStudyReviews }));

import { POST } from "@/app/api/cards/[id]/occlusion/auto-detect/route";

const SUPABASE_URL = "https://project.supabase.co";
const IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/card-media/user-1/card-1/diagram.png`;
const params = { params: Promise.resolve({ id: "card-1" }) };

const REJECTED_URLS = [
  "https://evil.example/storage/v1/object/public/card-media/user-1/card-1/diagram.png",
  "http://169.254.169.254/latest/meta-data/",
  "http://169.254.169.254/storage/v1/object/public/card-media/x.png",
  "http://localhost:54321/storage/v1/object/public/card-media/x.png",
  "data:image/png;base64,iVBORw0KGgo=",
];

describe("isCardMediaUrlOnOrigin", () => {
  it("accepts card-media object and render URLs on the project origin", () => {
    expect(isCardMediaUrlOnOrigin(IMAGE_URL, SUPABASE_URL)).toBe(true);
    expect(isCardMediaUrlOnOrigin(IMAGE_URL, `${SUPABASE_URL}/`)).toBe(true);
    expect(
      isCardMediaUrlOnOrigin(
        `${SUPABASE_URL}/storage/v1/render/image/public/card-media/a.png?width=960`,
        SUPABASE_URL,
      ),
    ).toBe(true);
  });

  it.each(REJECTED_URLS)("rejects %s", (url) => {
    expect(isCardMediaUrlOnOrigin(url, SUPABASE_URL)).toBe(false);
  });

  it("rejects look-alike hosts, credentials, dot segments and other buckets", () => {
    for (const url of [
      `https://project.supabase.co.evil.example/storage/v1/object/public/card-media/a.png`,
      `https://project.supabase.co@evil.example/storage/v1/object/public/card-media/a.png`,
      `https://user:pass@project.supabase.co/storage/v1/object/public/card-media/a.png`,
      `http://project.supabase.co/storage/v1/object/public/card-media/a.png`,
      `${SUPABASE_URL}:8443/storage/v1/object/public/card-media/a.png`,
      `${SUPABASE_URL}/storage/v1/object/public/card-media/../../../../auth/v1/settings`,
      `${SUPABASE_URL}/storage/v1/object/public/avatars/a.png`,
      `${SUPABASE_URL}/rest/v1/cards`,
    ]) {
      expect(isCardMediaUrlOnOrigin(url, SUPABASE_URL), url).toBe(false);
    }
  });

  it("rejects everything when the Supabase URL is missing or invalid", () => {
    expect(isCardMediaUrlOnOrigin(IMAGE_URL, undefined)).toBe(false);
    expect(isCardMediaUrlOnOrigin(IMAGE_URL, "")).toBe(false);
    expect(isCardMediaUrlOnOrigin(IMAGE_URL, "not a url")).toBe(false);
  });
});

function cardRow(imageUrl: string | null = IMAGE_URL) {
  return {
    id: "card-1",
    type: "image-occlusion",
    front: "",
    back: "",
    cloze_text: null,
    extra: null,
    occlusion_data: imageUrl ? { imageUrl, rects: [] } : null,
  };
}

function mockSupabase(card: unknown) {
  const select = {
    eq: vi.fn(() => select),
    single: vi.fn(async () => ({ data: card, error: card ? null : { message: "not found" } })),
  };
  const update = vi.fn((values: Record<string, unknown>) => {
    const chain = {
      eq: vi.fn(() => chain),
      select: vi.fn(() => chain),
      single: vi.fn(async () => ({
        data: { occlusion_data: values.occlusion_data, type: values.type },
        error: null,
      })),
    };
    return chain;
  });
  const from = vi.fn((table: string) => {
    expect(table).toBe("cards");
    return { select: vi.fn(() => select), update };
  });
  createClient.mockResolvedValue({ from });
  return { from, update };
}

function request(body?: unknown) {
  return new Request("https://app.test/api/cards/card-1/occlusion/auto-detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/cards/[id]/occlusion/auto-detect", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubGlobal("fetch", fetchMock);
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    detectOcclusionRectsByOcr.mockResolvedValue([
      { id: "region-1", x: 0.1, y: 0.25, width: 0.5, height: 0.2, label: "Cortex" },
    ]);
    reconcileOcclusionStudyReviews.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches an image on the project's card-media origin without following redirects", async () => {
    const { update } = mockSupabase(cardRow());
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
    );

    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
    );
    expect(detectOcclusionRectsByOcr).toHaveBeenCalledWith(expect.objectContaining({ length: 3 }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        occlusion_data: expect.objectContaining({ imageUrl: IMAGE_URL }),
      }),
    );
    expect(await response.json()).toMatchObject({ added: 1, type: "image-occlusion" });
  });

  it.each(REJECTED_URLS)("rejects a draft image URL of %s before fetching", async (imageUrl) => {
    const { update } = mockSupabase(cardRow());

    const response = await POST(request({ occlusion_data: { imageUrl, rects: [] } }), params);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a stored image URL on another host before fetching", async () => {
    mockSupabase(cardRow(REJECTED_URLS[0]!));

    const response = await POST(request(), params);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects every URL when NEXT_PUBLIC_SUPABASE_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    mockSupabase(cardRow());

    const response = await POST(request(), params);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a redirect as a failed load and does not leak the upstream status", async () => {
    const { update } = mockSupabase(cardRow());
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }),
    );

    const response = await POST(request(), params);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toContain("302");
    expect(detectOcclusionRectsByOcr).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("returns a generic error when the image fetch times out", async () => {
    mockSupabase(cardRow());
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const response = await POST(request(), params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Could not load the card image." });
  });
});
