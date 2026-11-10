import { describe, expect, it } from "vitest";
import {
  compareExams,
  dailyCapLabel,
  examCountdown,
  examReadyLine,
  examStageLabel,
  formatMinutes,
  formatPlanDay,
  formatRecall,
  formatSessionTime,
  isCramWindow,
  nextSessionLabel,
  readyLabel,
} from "@/lib/exams";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("exam labels", () => {
  it("names each stage", () => {
    expect(examStageLabel("learn")).toBe("Learn");
    expect(examStageLabel("strengthen")).toBe("Strengthen");
    expect(examStageLabel("lock-in")).toBe("Lock in");
    expect(examStageLabel("exam-day")).toBe("Exam day");
    expect(examStageLabel("done")).toBe("Done");
  });

  it("formats recall as a clamped whole percent", () => {
    expect(formatRecall(0.836)).toBe("84%");
    expect(formatRecall(1.2)).toBe("100%");
    expect(formatRecall(-1)).toBe("0%");
    expect(formatRecall(Number.NaN)).toBe("0%");
  });

  it("formats minutes, ready counts and daily limits", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
    expect(readyLabel(24, 12)).toBe("24 cards · 12 min");
    expect(readyLabel(1, 0)).toBe("1 card");
    expect(dailyCapLabel(null)).toBe("No limit");
    expect(dailyCapLabel(30)).toBe("30 min a day");
  });
});

describe("exam dates", () => {
  const now = new Date(2026, 10, 9, 10, 0, 0).getTime();
  const at = (ms: number) => new Date(now + ms).toISOString();

  it("counts down to the exam and back from it", () => {
    expect(examCountdown(at(12 * DAY + HOUR), now)).toBe("in 12 days");
    expect(examCountdown(at(DAY + HOUR), now)).toBe("in 1 day");
    expect(examCountdown(at(5 * HOUR + 60_000), now)).toBe("in 5 hours");
    expect(examCountdown(at(20 * 60_000), now)).toBe("in under an hour");
    expect(examCountdown(at(-3 * DAY - HOUR), now)).toBe("3 days ago");
  });

  it("calls only the last 24 hours a cram", () => {
    expect(isCramWindow(at(23 * HOUR), now)).toBe(true);
    expect(isCramWindow(at(25 * HOUR), now)).toBe(false);
    expect(isCramWindow(at(-HOUR), now)).toBe(false);
  });

  it("says when the next session opens", () => {
    expect(formatSessionTime(at(2 * HOUR), now)).toMatch(/^at /);
    expect(formatSessionTime(at(DAY), now)).toMatch(/^tomorrow at /);
    expect(nextSessionLabel(at(2 * HOUR), now)).toMatch(/^next session at /);
    expect(nextSessionLabel(at(-HOUR), now)).toBeNull();
    expect(nextSessionLabel(at(0), now)).toBeNull();
    expect(nextSessionLabel(null, now)).toBeNull();
  });

  it("describes what is ready, or when more opens", () => {
    expect(examReadyLine({ ready_now: 24, minutes_now: 12, next_session_at: at(0) }, now)).toBe(
      "24 cards · 12 min ready",
    );
    expect(examReadyLine({ ready_now: 0, minutes_now: 0, next_session_at: null }, now)).toBe(
      "Done for now",
    );
    expect(
      examReadyLine({ ready_now: 0, minutes_now: 0, next_session_at: at(DAY) }, now),
    ).toMatch(/^Done for now · next session tomorrow at /);
  });

  it("labels plan days", () => {
    expect(formatPlanDay("2026-11-09", 0)).toBe("Today");
    expect(formatPlanDay("2026-11-10", 1)).toBe("Tomorrow");
    expect(formatPlanDay("2026-11-20", 11)).toMatch(/20/);
  });
});

describe("exam order", () => {
  it("lists active exams soonest first, then completed, then archived", () => {
    const exams = [
      { id: "archived", status: "archived" as const, exam_at: "2026-10-01T00:00:00Z" },
      { id: "later", status: "active" as const, exam_at: "2026-12-20T00:00:00Z" },
      { id: "old", status: "completed" as const, exam_at: "2026-09-01T00:00:00Z" },
      { id: "soon", status: "active" as const, exam_at: "2026-11-12T00:00:00Z" },
      { id: "recent", status: "completed" as const, exam_at: "2026-11-01T00:00:00Z" },
    ];
    expect(exams.sort(compareExams).map((exam) => exam.id)).toEqual([
      "soon",
      "later",
      "recent",
      "old",
      "archived",
    ]);
  });
});
