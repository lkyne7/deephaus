import { describe, expect, it, vi } from "vitest";
import type { DesktopLocalAi } from "@deephaus/shared";
import { runLocalGeneration } from "@/lib/local-ai/run";

const prompt = { system: "s", user: "u" };
const step = (position: number, requests = [prompt]) => ({
  done: false,
  position,
  total: 2,
  repeats: 0,
  requests,
  schema: { type: "object" },
});

/** Answers each POST with the next scripted step and records the bodies. */
function scriptedServer(steps: unknown[]) {
  const bodies: Array<Record<string, unknown>> = [];
  const request = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify(steps.shift() ?? { done: true }));
  });
  return { bodies, request };
}

function fakeAi(generate: DesktopLocalAi["generate"]): DesktopLocalAi {
  return { status: vi.fn(), generate: vi.fn(generate), cancel: vi.fn(async () => undefined) };
}

const run = (
  ai: DesktopLocalAi | undefined,
  request: ReturnType<typeof scriptedServer>["request"],
  signal = new AbortController().signal,
) => runLocalGeneration({ jobId: "job-1", engine: "codex", ai, request, signal });

describe("runLocalGeneration", () => {
  it("walks every step and returns each answer to the server", async () => {
    const { bodies, request } = scriptedServer([step(0), step(1), { done: true }]);
    const ai = fakeAi(async () => '{"cards":[]}');
    await run(ai, request);
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(ai.generate).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "codex", system: "s", prompt: "u" }),
    );
    expect(bodies).toEqual([
      { position: 0 },
      { position: 0, outputs: ['{"cards":[]}'], repeats: 0 },
      { position: 1, outputs: ['{"cards":[]}'], repeats: 0 },
    ]);
  });

  it("sends one answer per request for a multi-type step", async () => {
    const { bodies, request } = scriptedServer([step(0, [prompt, prompt]), { done: true }]);
    await run(fakeAi(async () => "a"), request);
    expect(bodies[1]).toMatchObject({ outputs: ["a", "a"] });
  });

  it("reports a CLI failure so the job fails visibly", async () => {
    const { bodies, request } = scriptedServer([step(0)]);
    await run(
      fakeAi(async () => {
        throw new Error("Claude Code: limit reached");
      }),
      request,
    );
    expect(bodies.at(-1)).toEqual({ position: 0, error: "Claude Code: limit reached" });
  });

  it("fails the job instead of spending credits on a shell without the bridge", async () => {
    const { bodies, request } = scriptedServer([]);
    await run(undefined, request);
    expect(bodies).toEqual([{ position: 0, error: expect.stringContaining("Update the DeepHaus") }]);
  });

  it("cancels the running CLI on stop and lets the server close the job", async () => {
    const { bodies, request } = scriptedServer([step(0)]);
    const controller = new AbortController();
    const ai = fakeAi(async () => {
      controller.abort();
      throw new Error("Stopped.");
    });
    await run(ai, request, controller.signal);
    expect(bodies.at(-1)).toEqual({ position: 0 });
    expect(bodies.at(-1)).not.toHaveProperty("error");
  });
});
