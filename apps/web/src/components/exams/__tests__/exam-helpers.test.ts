import { describe, expect, it } from "vitest";
import type { ExamPlanDayDto, ExamScorePointDto, ExamStatus, ExamSummaryDto } from "@deephaus/shared";
import {
  atTargetLabel,
  curveChoiceLabel,
  curveChoices,
  dailyCapLabel,
  dateKeyInZone,
  examAtIso,
  examLocalFields,
  formatExamLong,
  formatExamShort,
  formatSessionTime,
  formatStudyWindow,
  getErrorMessage,
  groupExams,
  isCramExam,
  minutesLabel,
  nearestActiveExam,
  nextSessionLabel,
  parseDailyCap,
  percentLabel,
  planDayLabel,
  planDayLevel,
  planTotals,
  recallPercent,
  shortestOnTarget,
  stageLabel,
  studyNowLabel,
  studyWindowFromTime,
  timeLeftLabel,
  toggleStudyWindow,
  trackSummary,
} from "../exam-helpers";

const NOW = new Date("2026-11-05T15:00:00Z");
const TORONTO = { viewerTimeZone: "America/Toronto", now: NOW, locale: "en-US" };

function exam(id: string, status: ExamStatus, examAt: string, extra: Partial<ExamSummaryDto> = {}): ExamSummaryDto {
  return {
    id,
    name: id,
    exam_at: examAt,
    timezone: "America/Toronto",
    has_time: false,
    target_recall: 0.9,
    daily_minutes_cap: null,
    selection_spec: { deck_ids: [], source_ids: [], chunk_ids: [], tags: [], card_ids: [] },
    study_windows: [],
    result_score: null,
    status,
    archived_at: status === "archived" ? "2026-11-01T00:00:00Z" : null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    snapshot: {
      stage: status === "active" ? "learn" : "done",
      total: 65,
      unseen: 10,
      at_risk: 5,
      locked_in: 50,
      recall_now: 0.74,
      recall_at_exam: 0.6,
      share_at_target: 50 / 65,
    },
    ready_now: 0,
    minutes_now: 0,
    ready_by_deck: [],
    next_session_at: null,
    ...extra,
  };
}

const CURVE: ExamScorePointDto[] = [
  { minutes_per_day: null, recall_at_exam: 0.93 },
  { minutes_per_day: 30, recall_at_exam: 0.9 },
  { minutes_per_day: 10, recall_at_exam: 0.71 },
  { minutes_per_day: 20, recall_at_exam: 0.84 },
  { minutes_per_day: 45, recall_at_exam: 0.93 },
  { minutes_per_day: 60, recall_at_exam: 0.93 },
];

describe("numbers", () => {
  it("turns recall into whole percents", () => {
    expect(recallPercent(0.836)).toBe(84);
    expect(recallPercent(1.2)).toBe(100);
    expect(recallPercent(-0.1)).toBe(0);
    expect(recallPercent(null)).toBeNull();
    expect(recallPercent(Number.NaN)).toBeNull();
    expect(percentLabel(0.9)).toBe("90%");
    expect(percentLabel(undefined)).toBe("—");
  });

  it("labels minutes and daily limits", () => {
    expect(minutesLabel(8)).toBe("8 min");
    expect(minutesLabel(60)).toBe("1 hr");
    expect(minutesLabel(95)).toBe("1 hr 35 min");
    expect(dailyCapLabel(null)).toBe("No limit");
    expect(dailyCapLabel(20)).toBe("20 min a day");
  });

  it("reads a typed daily limit", () => {
    expect(parseDailyCap("25")).toBe(25);
    expect(parseDailyCap("0")).toBe(1);
    expect(parseDailyCap("999")).toBe(720);
    expect(parseDailyCap("")).toBeNull();
    expect(parseDailyCap("abc")).toBeNull();
  });

  it("counts cards at target", () => {
    expect(atTargetLabel({ locked_in: 50, total: 65 })).toBe("50 of 65 at target");
  });
});

describe("stageLabel", () => {
  it("names every stage", () => {
    expect(stageLabel("learn")).toBe("Learn");
    expect(stageLabel("strengthen")).toBe("Strengthen");
    expect(stageLabel("lock-in")).toBe("Lock in");
    expect(stageLabel("exam-day")).toBe("Exam day");
    expect(stageLabel("done")).toBe("Done");
  });
});

describe("groupExams", () => {
  const exams = [
    exam("a2", "active", "2026-11-20T00:00:00Z"),
    exam("done-old", "completed", "2026-10-20T00:00:00Z"),
    exam("a1", "active", "2026-11-13T00:00:00Z"),
    exam("arch", "archived", "2026-11-03T00:00:00Z"),
    exam("done-new", "completed", "2026-11-01T00:00:00Z"),
  ];

  it("puts active exams soonest first and finished ones latest first", () => {
    const groups = groupExams(exams);
    expect(groups.active.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(groups.completed.map((item) => item.id)).toEqual(["done-new", "done-old"]);
    expect(groups.archived.map((item) => item.id)).toEqual(["arch"]);
  });

  it("does not reorder the list it was given", () => {
    groupExams(exams);
    expect(exams.map((item) => item.id)).toEqual(["a2", "done-old", "a1", "arch", "done-new"]);
  });

  it("finds the nearest active exam for Home", () => {
    expect(nearestActiveExam(exams)?.id).toBe("a1");
    expect(nearestActiveExam([exam("done", "completed", "2026-11-01T00:00:00Z")])).toBeNull();
    expect(nearestActiveExam(undefined)).toBeNull();
  });
});

describe("isCramExam", () => {
  it("is true only inside the last 24 hours", () => {
    expect(isCramExam("2026-11-06T14:59:00Z", NOW)).toBe(true);
    expect(isCramExam("2026-11-06T15:00:00Z", NOW)).toBe(false);
    expect(isCramExam("2026-11-13T15:00:00Z", NOW)).toBe(false);
    expect(isCramExam("2026-11-05T14:00:00Z", NOW)).toBe(false);
    expect(isCramExam("nope", NOW)).toBe(false);
  });
});

describe("exam date formatting", () => {
  it("shows only the date for an exam without a time", () => {
    expect(
      formatExamLong("2026-11-13T14:00:00Z", { ...TORONTO, timezone: "America/Toronto", hasTime: false }),
    ).toBe("Friday, Nov 13");
  });

  it("keeps the calendar day the student picked in the exam's zone", () => {
    expect(
      formatExamLong("2026-11-13T14:00:00Z", {
        ...TORONTO,
        viewerTimeZone: "Asia/Tokyo",
        timezone: "America/Toronto",
        hasTime: false,
      }),
    ).toBe("Friday, Nov 13");
  });

  it("shows an exact time in the viewer's zone when they match", () => {
    expect(
      formatExamLong("2026-11-13T14:00:00Z", { ...TORONTO, timezone: "America/Toronto", hasTime: true }),
    ).toBe("Friday, Nov 13 at 9:00 AM");
  });

  it("reads a UTC exact time in the viewer's own time", () => {
    expect(
      formatExamLong("2026-11-13T01:21:00Z", { ...TORONTO, timezone: "UTC", hasTime: true }),
    ).toBe("Thursday, Nov 12 at 8:21 PM");
  });

  it("names another place's zone", () => {
    expect(
      formatExamLong("2026-11-13T00:00:00Z", { ...TORONTO, timezone: "Asia/Tokyo", hasTime: true }),
    ).toBe("Friday, Nov 13 at 9:00 AM Tokyo time");
    expect(
      formatExamLong("2026-11-13T14:00:00Z", { ...TORONTO, timezone: "America/New_York", hasTime: true }),
    ).toBe("Friday, Nov 13 at 9:00 AM New York time");
  });

  it("adds the year only when it differs", () => {
    expect(formatExamShort("2026-11-13T12:00:00Z", { ...TORONTO, timezone: "UTC" })).toBe("Nov 13");
    expect(formatExamShort("2027-01-02T12:00:00Z", { ...TORONTO, timezone: "UTC" })).toBe("Jan 2, 2027");
  });

  it("survives bad input", () => {
    expect(formatExamLong("nope", TORONTO)).toBe("Invalid date");
    expect(formatExamLong("2026-11-13T12:00:00Z", { ...TORONTO, timezone: "Mars/Base" })).toContain("Nov 13");
  });
});

describe("timeLeftLabel", () => {
  const toronto = { ...TORONTO, timezone: "America/Toronto" };

  it("counts calendar days in the exam's zone", () => {
    expect(timeLeftLabel("2026-11-13T14:00:00Z", toronto)).toBe("8 days left");
    expect(timeLeftLabel("2026-11-06T14:00:00Z", toronto)).toBe("Tomorrow");
    expect(timeLeftLabel("2026-11-05T22:00:00Z", toronto)).toBe("Today");
  });

  it("counts hours and minutes in the last day of an exam with a time", () => {
    expect(timeLeftLabel("2026-11-05T20:00:00Z", { ...toronto, hasTime: true })).toBe("In 5 hours");
    expect(timeLeftLabel("2026-11-05T16:00:00Z", { ...toronto, hasTime: true })).toBe("In 1 hour");
    expect(timeLeftLabel("2026-11-05T15:40:00Z", { ...toronto, hasTime: true })).toBe("In 40 minutes");
    expect(timeLeftLabel("2026-11-13T14:00:00Z", { ...toronto, hasTime: true })).toBe("8 days left");
  });

  it("says when the exam has gone", () => {
    expect(timeLeftLabel("2026-11-05T14:59:59Z", toronto)).toBe("Passed");
  });
});

describe("study session labels", () => {
  it("sizes the session that is ready", () => {
    expect(studyNowLabel({ ready_now: 24, minutes_now: 8 })).toBe("24 cards · 8 min");
    expect(studyNowLabel({ ready_now: 1, minutes_now: 0 })).toBe("1 card · 1 min");
  });

  it("says when the next session opens in the viewer's time", () => {
    expect(formatSessionTime("2026-11-05T21:30:00Z", TORONTO)).toBe("at 4:30 PM");
    expect(formatSessionTime("2026-11-06T13:00:00Z", TORONTO)).toBe("tomorrow at 8:00 AM");
    expect(formatSessionTime("2026-11-13T13:00:00Z", TORONTO)).toBe("Fri, Nov 13 at 8:00 AM");
    expect(formatSessionTime("2026-11-05T14:00:00Z", TORONTO)).toBe("now");
    expect(nextSessionLabel({ next_session_at: "2026-11-05T21:30:00Z" }, TORONTO)).toBe(
      "Next session opens at 4:30 PM",
    );
    expect(nextSessionLabel({ next_session_at: null }, TORONTO)).toBeNull();
  });
});

describe("exam instants", () => {
  it("turns a local date and time into an instant", () => {
    expect(examAtIso("2026-11-13", "14:30", "America/Toronto")).toBe("2026-11-13T19:30:00.000Z");
    expect(examAtIso("2026-07-01", "09:00", "Asia/Tokyo")).toBe("2026-07-01T00:00:00.000Z");
  });

  it("plans a date-only exam for 9:00 that morning", () => {
    expect(examAtIso("2026-11-13", null, "America/Toronto")).toBe("2026-11-13T14:00:00.000Z");
    expect(dateKeyInZone(new Date("2026-11-13T14:00:00.000Z"), "America/Toronto")).toBe("2026-11-13");
  });

  it("handles a daylight-saving change", () => {
    // Toronto leaves daylight time on 1 November 2026.
    expect(examAtIso("2026-10-31", "09:00", "America/Toronto")).toBe("2026-10-31T13:00:00.000Z");
    expect(examAtIso("2026-11-01", "09:00", "America/Toronto")).toBe("2026-11-01T14:00:00.000Z");
  });

  it("rejects what is not a date", () => {
    expect(examAtIso("", "09:00", "UTC")).toBeNull();
    expect(examAtIso("2026-11-13", "soon", "UTC")).toBeNull();
  });

  it("round-trips through the form's fields", () => {
    const iso = examAtIso("2026-11-13", "14:30", "America/Toronto")!;
    expect(examLocalFields(iso, "America/Toronto")).toEqual({ date: "2026-11-13", time: "14:30" });
    expect(examLocalFields(iso, "Asia/Tokyo")).toEqual({ date: "2026-11-14", time: "04:30" });
  });
});

describe("study times", () => {
  it("formats minutes after midnight", () => {
    expect(formatStudyWindow(480, "en-US")).toBe("8:00 AM");
    expect(formatStudyWindow(19 * 60 + 30, "en-US")).toBe("7:30 PM");
  });

  it("reads a time input", () => {
    expect(studyWindowFromTime("08:00")).toBe(480);
    expect(studyWindowFromTime("19:30")).toBe(1170);
    expect(studyWindowFromTime("")).toBeNull();
    expect(studyWindowFromTime("25:00")).toBeNull();
  });

  it("adds, removes and stops at three", () => {
    expect(toggleStudyWindow([840], 480)).toEqual([480, 840]);
    expect(toggleStudyWindow([480, 840], 480)).toEqual([840]);
    expect(toggleStudyWindow([480, 840, 1140], 600)).toEqual([480, 840, 1140]);
    expect(toggleStudyWindow([480, 840, 1140], 840)).toEqual([480, 1140]);
  });
});

describe("curveChoices", () => {
  it("orders budgets shortest first with no limit last", () => {
    const choices = curveChoices(CURVE, null, 0.93, 0.9);
    expect(choices.map((choice) => choice.minutes)).toEqual([10, 20, 30, 45, 60, null]);
    expect(choices.filter((choice) => choice.selected).map((choice) => choice.minutes)).toEqual([null]);
    expect(choices.some((choice) => choice.custom)).toBe(false);
  });

  it("selects the budget that matches the daily limit", () => {
    const choices = curveChoices(CURVE, 20, 0.84, 0.9);
    const selected = choices.find((choice) => choice.selected);
    expect(selected).toMatchObject({ minutes: 20, recall: 0.84, custom: false, meetsTarget: false });
    expect(curveChoiceLabel(selected!)).toBe("20 min a day → 84%");
  });

  it("slots in a limit the planner did not sample, with the plan's own projection", () => {
    const choices = curveChoices(CURVE, 25, 0.87, 0.9);
    expect(choices.map((choice) => choice.minutes)).toEqual([10, 20, 25, 30, 45, 60, null]);
    expect(choices[2]).toMatchObject({ minutes: 25, recall: 0.87, selected: true, custom: true });
  });

  it("marks what reaches the target, within the planner's half point", () => {
    const choices = curveChoices([...CURVE, { minutes_per_day: 35, recall_at_exam: 0.896 }], null, 0.93, 0.9);
    expect(choices.filter((choice) => choice.meetsTarget).map((choice) => choice.minutes)).toEqual([
      30, 35, 45, 60, null,
    ]);
    expect(shortestOnTarget(choices)?.minutes).toBe(30);
  });

  it("has no shortest budget when nothing reaches the target", () => {
    expect(shortestOnTarget(curveChoices(CURVE, null, 0.93, 0.97))).toBeNull();
  });

  it("still shows the current setting without a curve", () => {
    expect(curveChoices([], null, 0.8, 0.9)).toEqual([
      { minutes: null, recall: 0.8, selected: true, custom: true, meetsTarget: false },
    ]);
  });
});

describe("trackSummary", () => {
  const base = {
    onTrack: true,
    projected: 0.92,
    target: 0.9,
    cap: null,
    typicalMinutes: 25,
    peakMinutes: 40,
    uncapped: 0.92,
  };

  it("says what an on-track plan asks for", () => {
    const summary = trackSummary(base);
    expect(summary.onTrack).toBe(true);
    expect(summary.headline).toBe("On track for 92%");
    expect(summary.detail).toBe("The plan asks for about 25 minutes a day, 40 min on the busiest day.");
  });

  it("confirms a daily limit that is enough", () => {
    expect(trackSummary({ ...base, cap: 30 }).detail).toBe("30 min a day is enough for your 90% target.");
  });

  it("says plainly when a limit falls short and what lifting it would do", () => {
    const summary = trackSummary({ ...base, onTrack: false, projected: 0.84, cap: 20 });
    expect(summary.onTrack).toBe(false);
    expect(summary.headline).toBe("Heading for 84%, below your 90% target");
    expect(summary.detail).toBe(
      "20 min a day is not enough. Without a limit the plan needs about 25 minutes a day and reaches 92%.",
    );
  });

  it("adds days or fewer cards when no limit would still fall short", () => {
    const summary = trackSummary({ ...base, onTrack: false, projected: 0.7, cap: 20, uncapped: 0.82 });
    expect(summary.detail).toBe(
      "20 min a day is not enough. Without a limit the plan needs about 25 minutes a day and reaches 82%. More days or fewer cards would close the rest.",
    );
  });

  it("does not blame a limit that changes nothing", () => {
    const summary = trackSummary({ ...base, onTrack: false, projected: 0.82, cap: 60, uncapped: 0.82 });
    expect(summary.detail).toBe(
      "There is not enough time before the exam, even at about 25 minutes a day. More days or fewer cards would close the gap.",
    );
    expect(trackSummary({ ...base, onTrack: false, projected: 0.82, uncapped: 0.82 }).detail).toBe(
      summary.detail,
    );
  });
});

describe("day-by-day plan", () => {
  const days: ExamPlanDayDto[] = [
    { date: "2026-11-05", reviews: 60, new_cards: 12, minutes: 30, recall_at_exam: 0.5 },
    { date: "2026-11-06", reviews: 0, new_cards: 0, minutes: 0, recall_at_exam: 0.5 },
    { date: "2026-11-07", reviews: 20, new_cards: 0, minutes: 10, recall_at_exam: 0.62 },
  ];

  it("totals the plan", () => {
    expect(planTotals(days)).toEqual({ minutes: 40, newCards: 12, reviews: 80, studyDays: 2, peak: 30 });
    expect(planTotals([])).toEqual({ minutes: 0, newCards: 0, reviews: 0, studyDays: 0, peak: 0 });
  });

  it("shades days against the busiest", () => {
    expect(planDayLevel(0, 30)).toBe(0);
    expect(planDayLevel(10, 30)).toBe(1);
    expect(planDayLevel(15, 30)).toBe(2);
    expect(planDayLevel(30, 30)).toBe(3);
    expect(planDayLevel(5, 0)).toBe(0);
  });

  it("describes a day", () => {
    expect(planDayLabel(days[0])).toBe("30 min · 12 new · 60 reviews");
    expect(planDayLabel(days[1])).toBe("Rest day");
    expect(planDayLabel(days[2])).toBe("10 min · 20 reviews");
    expect(planDayLabel({ minutes: 0, new_cards: 0, reviews: 1 })).toBe("1 min · 1 review");
  });
});

describe("getErrorMessage", () => {
  it("prefers the server's message", () => {
    expect(getErrorMessage({ error: "Choose a date and time in the future" }, "Fallback")).toBe(
      "Choose a date and time in the future",
    );
    expect(getErrorMessage({ message: "Nope" }, "Fallback")).toBe("Nope");
    expect(getErrorMessage({ error: "  " }, "Fallback")).toBe("Fallback");
    expect(getErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});
