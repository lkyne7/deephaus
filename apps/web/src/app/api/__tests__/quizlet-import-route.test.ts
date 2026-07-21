import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireAuth, loadGlobalStudySettings } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  loadGlobalStudySettings: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth }));
vi.mock("@/lib/fsrs/user-study-settings", () => ({ loadGlobalStudySettings }));

import { POST } from "@/app/api/import/quizlet/route";

function returningInsert(data: Record<string, unknown>) {
  const chain = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => ({ data, error: null })),
  };
  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  return chain;
}

function request(content: string, deckName = "Biology") {
  return new Request("https://app.test/api/import/quizlet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, deck_name: deckName }),
  });
}

describe("POST /api/import/quizlet", () => {
  const project = returningInsert({ id: "project-1" });
  const source = returningInsert({ id: "source-1" });
  const job = returningInsert({ id: "job-1" });
  const cards = { insert: vi.fn(async () => ({ error: null })) };
  const from = vi.fn((table: string) => {
    if (table === "projects") return project;
    if (table === "sources") return source;
    if (table === "generation_jobs") return job;
    if (table === "cards") return cards;
    throw new Error(`Unexpected table: ${table}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({
      user: { id: "user-1" },
      supabase: { from },
      response: null,
    });
    loadGlobalStudySettings.mockResolvedValue({
      desiredRetention: 0.9,
      newCardsPerDay: 20,
    });
  });

  it("creates a deck and imports escaped basic cards", async () => {
    const response = await POST(request("<b>Term</b>\tLine 1\nLine 2\tAnswer"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ cardsImported: 2 });
    expect(project.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", deck_name: "Biology" }),
    );
    expect(cards.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        job_id: "job-1",
        type: "basic",
        front: "&lt;b&gt;Term&lt;/b&gt;",
        back: "Line 1",
        sort_order: 0,
      }),
      expect.objectContaining({
        front: "Line 2",
        back: "Answer",
        sort_order: 1,
      }),
    ]);
  });

  it("rejects exports without term-definition pairs", async () => {
    const response = await POST(request("Only one column"));

    expect(response.status).toBe(422);
    expect(project.insert).not.toHaveBeenCalled();
  });
});
