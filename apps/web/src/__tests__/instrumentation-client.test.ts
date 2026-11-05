import { afterEach, expect, it, vi } from "vitest";

const { init, register } = vi.hoisted(() => ({ init: vi.fn(), register: vi.fn() }));

vi.mock("posthog-js", () => ({ default: { init, register } }));

afterEach(() => {
  vi.unstubAllEnvs();
});

it("keeps rendered text out of session replays and autocapture", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  await import("../../instrumentation-client");
  expect(init).toHaveBeenCalledWith(
    "phc_test",
    expect.objectContaining({
      mask_all_text: true,
      session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    }),
  );
});
