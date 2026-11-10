import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireAuth, loadGlobalStudySettings, invalidateUserStudyCaches } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  loadGlobalStudySettings: vi.fn(),
  invalidateUserStudyCaches: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth, requireUser: requireAuth }));
vi.mock("@/lib/fsrs/user-study-settings", () => ({ loadGlobalStudySettings }));
vi.mock("@/lib/cache/invalidate", () => ({ invalidateUserStudyCaches }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "@/app/api/projects/route";
import { PATCH } from "@/app/api/projects/[id]/route";

function chain(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["insert", "update", "select", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => result);
  return query;
}

function post(body: string) {
  return new Request("https://app.test/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function patch(body: string) {
  return PATCH(
    new Request("https://app.test/api/projects/deck-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id: "deck-1" }) },
  );
}

describe("POST /api/projects", () => {
  let projects: ReturnType<typeof chain>;
  const from = vi.fn(() => projects);

  beforeEach(() => {
    vi.clearAllMocks();
    projects = chain({ data: { id: "deck-1" }, error: null });
    requireAuth.mockResolvedValue({ user: { id: "user-1" }, supabase: { from }, response: null });
    loadGlobalStudySettings.mockResolvedValue({ desiredRetention: 0.9, newCardsPerDay: 20 });
  });

  it("creates a deck with trimmed names", async () => {
    const response = await POST(post(JSON.stringify({ name: "  Biology  ", deck_name: " Biology " })));

    expect(response.status).toBe(201);
    expect(projects.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", name: "Biology", deck_name: "Biology" }),
    );
  });

  it("keeps the existing client payload with settings working", async () => {
    const response = await POST(
      post(JSON.stringify({ name: "Chem", deck_name: "Chem", settings: { cardMix: "cloze" } })),
    );

    expect(response.status).toBe(201);
    expect(projects.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Chem",
        settings: expect.objectContaining({ cardMix: "cloze", desiredRetention: 0.9 }),
      }),
    );
  });

  it("uses the name as the display name when deck_name is omitted", async () => {
    await POST(post(JSON.stringify({ name: "Physics" })));
    expect(projects.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Physics", deck_name: "Physics" }),
    );
  });

  it("accepts a 120-character Unicode name", async () => {
    const name = "é".repeat(120);
    const response = await POST(post(JSON.stringify({ name, deck_name: name })));
    expect(response.status).toBe(201);
  });

  it.each([
    ["an empty name", { name: "", deck_name: "" }, "Deck name cannot be empty."],
    ["a whitespace name", { name: "   ", deck_name: "   " }, "Deck name cannot be empty."],
    ["an object name", { name: { bad: true }, deck_name: 42 }, "Deck name must be text."],
    ["a null name", { name: null }, "Deck name must be text."],
    ["a missing name", {}, "Deck name is required."],
    ["a 121-character name", { name: "a".repeat(121) }, "Deck name must be 120 characters or fewer."],
    ["a bad display name", { name: "Fine", deck_name: 42 }, "Deck name must be text."],
    ["non-object settings", { name: "Fine", settings: "fast" }, "Expected object, received string"],
  ])("rejects %s without inserting", async (_label, body, message) => {
    const response = await POST(post(JSON.stringify(body)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(projects.insert).not.toHaveBeenCalled();
  });

  it("rejects settings outside the allowed ranges", async () => {
    const response = await POST(post(JSON.stringify({ name: "Fine", settings: { desiredRetention: 5 } })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Deck settings are invalid." });
    expect(projects.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{", "Request body must be valid JSON."],
    ["a JSON null body", "null", "Send a JSON object with a deck name."],
    ["a JSON array body", "[]", "Send a JSON object with a deck name."],
  ])("returns 400 for %s", async (_label, body, message) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(projects.insert).not.toHaveBeenCalled();
  });

  it("does not expose database errors", async () => {
    projects = chain({
      data: null,
      error: { message: 'null value in column "name" of relation "projects" violates not-null constraint' },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(post(JSON.stringify({ name: "Fine" })));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not create the deck." });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("PATCH /api/projects/[id]", () => {
  let projects: ReturnType<typeof chain>;
  const from = vi.fn(() => projects);

  beforeEach(() => {
    vi.clearAllMocks();
    projects = chain({ data: { id: "deck-1", settings: {} }, error: null });
    requireAuth.mockResolvedValue({ user: { id: "user-1" }, supabase: { from }, response: null });
  });

  it("trims renamed decks", async () => {
    const response = await patch(JSON.stringify({ name: " New name ", deck_name: " New name " }));

    expect(response.status).toBe(200);
    expect(projects.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New name", deck_name: "New name" }),
    );
  });

  it.each([
    ["a whitespace name", JSON.stringify({ name: "   " }), "Deck name cannot be empty."],
    ["a 121-character name", JSON.stringify({ name: "a".repeat(121) }), "Deck name must be 120 characters or fewer."],
    ["malformed JSON", "{", "Request body must be valid JSON."],
  ])("rejects %s", async (_label, body, message) => {
    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(projects.update).not.toHaveBeenCalled();
  });
});
