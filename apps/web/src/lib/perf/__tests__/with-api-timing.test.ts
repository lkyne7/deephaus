import { describe, expect, it, vi } from "vitest";
import { withApiTiming } from "@/lib/perf/with-api-timing";

describe("withApiTiming", () => {
  it("returns a generic 500 and logs the real error on the server", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("Cannot read properties of null (reading 'settings')");
    const handler = withApiTiming(async (): Promise<Response> => {
      throw failure;
    }, "POST /api/example");

    const response = await handler();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong. Please try again." });
    expect(consoleError).toHaveBeenCalledWith("[POST /api/example]", failure);
    consoleError.mockRestore();
  });

  it("passes successful responses through", async () => {
    const handler = withApiTiming(async () => Response.json({ ok: true }, { status: 201 }), "GET /api/example");
    const response = await handler();
    expect(response.status).toBe(201);
  });
});
