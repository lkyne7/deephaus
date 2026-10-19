import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch", () => ({ apiFetch: vi.fn() }));

import { createSourceDocumentSaver } from "@/lib/sources/source-document-saver";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Fake PUT endpoint that enforces the same version check as the route. */
function fakeServer(initialVersion: string | null) {
  let version = initialVersion;
  let tick = 0;
  const saved: unknown[] = [];
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { content: unknown; contentEditedAt: string | null };
    // Yield so overlapping saves would interleave if the saver didn't queue them.
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (body.contentEditedAt !== version) {
      return Response.json({ error: "stale", contentEditedAt: version }, { status: 409 });
    }
    version = `2026-10-19T12:00:0${++tick}.000Z`;
    saved.push(body.content);
    return Response.json({ ok: true, contentEditedAt: version });
  });
  return {
    request,
    saved,
    edit(next: string) {
      version = next;
    },
  };
}

describe("createSourceDocumentSaver", () => {
  it("sends the loaded version and tracks the version each save returns", async () => {
    const server = fakeServer("2026-10-19T12:00:00.000Z");
    const onSaved = vi.fn();
    const saver = createSourceDocumentSaver({
      sourceId: "src",
      contentEditedAt: "2026-10-19T12:00:00.000Z",
      lastSaved: JSON.stringify(doc("Start")),
      request: server.request,
      onSaved,
    });

    expect(await saver.save(doc("One"))).toBe("saved");
    expect(await saver.save(doc("Two"))).toBe("saved");
    expect(saver.contentEditedAt).toBe("2026-10-19T12:00:02.000Z");
    expect(onSaved).toHaveBeenLastCalledWith(doc("Two"), "2026-10-19T12:00:02.000Z");
  });

  it("queues overlapping saves instead of conflicting with itself", async () => {
    const server = fakeServer(null);
    const saver = createSourceDocumentSaver({
      sourceId: "src",
      contentEditedAt: null,
      lastSaved: "",
      request: server.request,
    });

    const results = await Promise.all([saver.save(doc("A")), saver.save(doc("B"))]);
    expect(results).toEqual(["saved", "saved"]);
    expect(server.saved).toEqual([doc("A"), doc("B")]);
  });

  it("skips content that is already saved", async () => {
    const server = fakeServer(null);
    const saver = createSourceDocumentSaver({
      sourceId: "src",
      contentEditedAt: null,
      lastSaved: JSON.stringify(doc("Same")),
      request: server.request,
    });
    expect(await saver.save(doc("Same"))).toBe("unchanged");
    expect(server.request).not.toHaveBeenCalled();
  });

  it("stops saving after a conflict so a stale tab never overwrites newer edits", async () => {
    const server = fakeServer("2026-10-19T12:00:00.000Z");
    const saver = createSourceDocumentSaver({
      sourceId: "src",
      contentEditedAt: "2026-10-19T12:00:00.000Z",
      lastSaved: "",
      request: server.request,
    });
    server.edit("2026-10-19T13:00:00.000Z"); // another tab saved

    expect(await saver.save(doc("Stale"))).toBe("conflict");
    expect(saver.conflicted).toBe(true);
    expect(await saver.save(doc("Still stale"))).toBe("conflict");
    expect(server.request).toHaveBeenCalledTimes(1);
    expect(server.saved).toEqual([]);
  });

  it("reports other failures as errors and keeps the last saved version", async () => {
    const request = vi.fn(async () => new Response("boom", { status: 500 }));
    const saver = createSourceDocumentSaver({
      sourceId: "src",
      contentEditedAt: "v1",
      lastSaved: "",
      request,
    });
    expect(await saver.save(doc("X"))).toBe("error");
    expect(saver.contentEditedAt).toBe("v1");
    expect(saver.conflicted).toBe(false);
  });
});
