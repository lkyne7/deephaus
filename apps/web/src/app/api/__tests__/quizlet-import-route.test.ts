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
    delete: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({ data, error: null })),
  };
  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function request(content: string, deckName = "Biology", extra: Record<string, unknown> = {}) {
  return new Request("https://app.test/api/import/quizlet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, deck_name: deckName, ...extra }),
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

  it("stores literal quotes exactly and keeps every card separate", async () => {
    const response = await POST(request('1\tFirst\n2\tA 6" ruler\n3\tThird'));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ cardsImported: 3, skippedRows: [] });
    expect(cards.insert).toHaveBeenCalledWith([
      expect.objectContaining({ front: "1", back: "First" }),
      expect.objectContaining({ front: "2", back: "A 6&quot; ruler" }),
      expect.objectContaining({ front: "3", back: "Third" }),
    ]);
  });

  it("rejects incomplete rows with their line numbers unless skipping is confirmed", async () => {
    const response = await POST(request("1\tFirst\n2\t\n3\tThird"));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: "The row on line 2 is missing a term or definition.",
      code: "incomplete_rows",
      cardsFound: 2,
      skippedRows: [{ line: 2, reason: "missing_definition" }],
    });
    expect(project.insert).not.toHaveBeenCalled();
    expect(cards.insert).not.toHaveBeenCalled();
  });

  it("imports the complete rows and reports the skipped ones when confirmed", async () => {
    const response = await POST(
      request("1\tFirst\n2\t\n3\tThird", "Biology", { skip_incomplete_rows: true }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      cardsImported: 2,
      skippedRows: [{ line: 2, reason: "missing_definition" }],
    });
    expect(cards.insert).toHaveBeenCalledWith([
      expect.objectContaining({ front: "1", back: "First", sort_order: 0 }),
      expect.objectContaining({ front: "3", back: "Third", sort_order: 1 }),
    ]);
  });

  it("hides database errors behind a generic message", async () => {
    cards.insert.mockResolvedValueOnce({
      error: { message: 'insert or update on table "cards" violates foreign key constraint' },
    } as never);
    const response = await POST(request("A\tB"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Quizlet import failed. Try again.");
    expect(project.delete).toHaveBeenCalled();
  });
});
