import { describe, expect, it } from "vitest";
import {
  PENDING_TIMEOUT_MS,
  STALLED_TIMEOUT_MS,
  checkJobStall,
  createStallTracker,
} from "@/lib/background-job-stall";

describe("checkJobStall", () => {
  it("gives up on a job that is never picked up", () => {
    const tracker = createStallTracker(0);
    const pending = { status: "pending", phase: null, progress: 0 };
    expect(checkJobStall(tracker, "export", pending, PENDING_TIMEOUT_MS - 1)).toBeNull();
    expect(checkJobStall(tracker, "export", pending, PENDING_TIMEOUT_MS)).toMatch(/export didn't start/);
  });

  it("keeps waiting while a processing job makes progress", () => {
    const tracker = createStallTracker(0);
    let now = 0;
    for (let progress = 0; progress <= 90; progress += 10) {
      now += STALLED_TIMEOUT_MS - 1;
      expect(checkJobStall(tracker, "import", { status: "processing", progress }, now)).toBeNull();
    }
  });

  it("gives up when a processing job stops changing", () => {
    const tracker = createStallTracker(0);
    const job = { status: "processing", phase: "media", progress: 40 };
    expect(checkJobStall(tracker, "import", job, 1_000)).toBeNull();
    expect(checkJobStall(tracker, "import", job, 1_000 + STALLED_TIMEOUT_MS)).toMatch(/import stopped making progress/);
  });

  it("does not time out a claimed job on the pending clock", () => {
    const tracker = createStallTracker(0);
    expect(checkJobStall(tracker, "export", { status: "processing", progress: 5 }, PENDING_TIMEOUT_MS * 2)).toBeNull();
  });
});
