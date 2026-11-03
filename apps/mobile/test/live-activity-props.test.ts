import { describe, expect, it } from "vitest";
import {
  buildStudySessionActivityProps,
  formatElapsed,
} from "@/lib/live-activities/study-session-props";
import {
  buildTaskActivityProps,
  quantiseProgress,
  taskActivityPropsChanged,
} from "@/lib/live-activities/task-activity-props";

describe("study session live activity props", () => {
  const grades = { again: 2, hard: 1, good: 10, easy: 3 };

  it("formats elapsed time as mm:ss and h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(9 * 60_000 + 48_000)).toBe("09:48");
    expect(formatElapsed(3_600_000 + 65_000)).toBe("1:01:05");
  });

  it("describes an active deck review", () => {
    const props = buildStudySessionActivityProps({
      kind: "review",
      title: " Cardiology ",
      done: 16,
      remaining: 12,
      grades,
      startedAt: 1_000,
      status: "active",
    });
    expect(props).toMatchObject({
      title: "Cardiology",
      subtitle: "Review session",
      done: 16,
      remaining: 12,
      status: "active",
      summary: "",
    });
  });

  it("describes a cram session with readiness and a completion summary", () => {
    const props = buildStudySessionActivityProps({
      kind: "cram",
      title: "Finals",
      readiness: 72.4,
      done: 30,
      remaining: 4,
      grades,
      startedAt: 0,
      status: "complete",
      now: 9 * 60_000 + 48_000,
    });
    expect(props.subtitle).toBe("Cram · 72% ready");
    expect(props.remaining).toBe(0);
    expect(props.summary).toBe("30 cards in 09:48");
  });

  it("falls back to a generic title", () => {
    expect(
      buildStudySessionActivityProps({
        kind: "review",
        title: "",
        done: 0,
        remaining: 3,
        grades,
        startedAt: 0,
        status: "active",
      }).title,
    ).toBe("Study session");
  });
});

describe("background task live activity props", () => {
  const base = {
    kind: "generation" as const,
    title: "notes.pdf",
    sourceLabel: "notes.pdf",
    deckName: "Cardiology",
    phaseLabel: "Extracting content…",
    progress: 42,
    status: "running" as const,
    createdAt: 1_000,
    progressStartedAt: 5_000,
    etaMs: 120_000,
    now: 100_000,
  };

  it("quantises progress to 5% steps", () => {
    expect(quantiseProgress(42)).toBe(40);
    expect(quantiseProgress(43)).toBe(45);
    expect(quantiseProgress(-4)).toBe(0);
    expect(quantiseProgress(140)).toBe(100);
  });

  it("describes a running generation with a padded, rounded estimate", () => {
    const props = buildTaskActivityProps(base);
    expect(props).toMatchObject({
      kind: "generation",
      title: "Generating cards",
      detail: "From notes.pdf · into Cardiology",
      phase: "Extracting content…",
      progress: 40,
      startedAt: 5_000,
      status: "running",
    });
    // 100s + 120s * 1.15 = 238s, rounded to the nearest 15s.
    expect(props.etaAt).toBe(240_000);
  });

  it("drops the estimate when there is none", () => {
    expect(buildTaskActivityProps({ ...base, etaMs: null }).etaAt).toBeNull();
  });

  it("describes finished and failed tasks", () => {
    const ready = buildTaskActivityProps({ ...base, status: "ready", progress: 100, cardsAdded: 24 });
    expect(ready.title).toBe("24 cards added");
    expect(ready.detail).toBe("Added to Cardiology · Tap to view");
    expect(ready.progress).toBe(100);
    expect(ready.etaAt).toBeNull();

    const failed = buildTaskActivityProps({ ...base, status: "failed", error: "Generation failed" });
    expect(failed.title).toBe("Card generation failed");
    expect(failed.phase).toBe("Generation failed");

    const imported = buildTaskActivityProps({
      ...base,
      kind: "anki-import",
      title: "Anki import",
      status: "ready",
    });
    expect(imported.title).toBe("Import complete");
  });

  it("only reports a change when something visible moved", () => {
    const a = buildTaskActivityProps(base);
    expect(taskActivityPropsChanged(null, a)).toBe(true);
    expect(taskActivityPropsChanged(a, { ...a })).toBe(false);
    expect(taskActivityPropsChanged(a, { ...a, etaAt: a.etaAt! + 30_000 })).toBe(false);
    expect(taskActivityPropsChanged(a, { ...a, etaAt: a.etaAt! + 90_000 })).toBe(true);
    expect(taskActivityPropsChanged(a, { ...a, progress: 45 })).toBe(true);
    expect(taskActivityPropsChanged(a, { ...a, etaAt: null })).toBe(true);
  });
});
