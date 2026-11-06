import type { DesktopLocalAi, LocalAiEngine } from "@deephaus/shared";
import { readJson } from "@/lib/background-tasks/api";

type LocalStep =
  | { done: true }
  | {
      done: false;
      position: number;
      total: number;
      repeats: number;
      requests: Array<{ system: string; user: string }>;
      schema: Record<string, unknown>;
    };

/** The first step can embed a whole book before it returns. */
const STEP_TIMEOUT_MS = 280_000;

/**
 * Drive one generation job on the user's own plan: the server hands out prompts
 * and saves cards; this runs each model call through the desktop app. The job
 * row stays the source of truth, so the normal job polling reports progress.
 */
export async function runLocalGeneration(input: {
  jobId: string;
  engine: LocalAiEngine;
  ai: DesktopLocalAi | undefined;
  request: (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;
  signal: AbortSignal;
}): Promise<void> {
  const { jobId, engine, ai, request, signal } = input;

  const sendStep = async (body: Record<string, unknown>) => {
    const res = await request(
      `/api/jobs/${jobId}/local`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      STEP_TIMEOUT_MS,
    );
    return readJson<LocalStep>(res);
  };

  let position = 0;
  try {
    if (!ai) throw new Error("Update the DeepHaus desktop app to generate with your own plan.");
    let step = await sendStep({ position });
    while (!step.done) {
      const { requests, schema, repeats } = step;
      position = step.position;
      const outputs: string[] = [];
      // Multi-type runs have one request per card type; each is a separate CLI run.
      for (const prompt of requests) {
        const id = crypto.randomUUID();
        const cancel = () => void ai.cancel(id);
        signal.addEventListener("abort", cancel, { once: true });
        try {
          outputs.push(
            await ai.generate({ id, engine, system: prompt.system, prompt: prompt.user, schema }),
          );
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      }
      step = await sendStep({ position, outputs, repeats });
    }
  } catch (error) {
    // After a stop, the next step sees the cancel request and closes the job.
    if (signal.aborted) {
      await sendStep({ position }).catch(() => undefined);
      return;
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    await sendStep({ position, error: message.slice(0, 500) }).catch(() => undefined);
  }
}
