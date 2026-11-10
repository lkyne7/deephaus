import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_PREFS,
  chooseReminder,
  nextReminderCheck,
  type ReminderExam,
  type ReminderInput,
  type SentReminder,
} from "../src/reminders";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A Monday. Times below are UTC, and the student is in UTC. */
const at = (time: string, day = "2026-11-09") => new Date(`${day}T${time}:00.000Z`);

function exam(overrides: Partial<ReminderExam> = {}): ReminderExam {
  return {
    id: "bio",
    name: "Bio final",
    examAt: at("09:00", "2026-11-16"),
    targetRecall: 0.9,
    studyWindows: [19 * 60],
    readyNow: 24,
    minutesNow: 8,
    ...overrides,
  };
}

function input(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    now: at("19:05"),
    timezone: "UTC",
    dayStartHour: 4,
    prefs: DEFAULT_REMINDER_PREFS,
    exams: [],
    regular: { due: 0, minutes: 0, reviewedToday: 0 },
    lastReviewAt: null,
    sent: [],
    ...overrides,
  };
}

const sent = (kind: SentReminder["kind"], sentAt: Date, extra: Partial<SentReminder> = {}): SentReminder => ({
  kind,
  dedupeKey: `${kind}:${sentAt.toISOString()}`,
  sentAt,
  openedAt: null,
  ...extra,
});

describe("chooseReminder", () => {
  it("sends an exam session reminder at the student's study time", () => {
    const reminder = chooseReminder(input({ exams: [exam()] }));
    expect(reminder).toMatchObject({
      kind: "exam_session",
      examId: "bio",
      title: "Bio final is in 7 days",
      body: "Ready now: 24 cards · about 8 min.",
      target: { type: "exam", id: "bio" },
    });
  });

  it("only within half an hour of that time", () => {
    expect(chooseReminder(input({ exams: [exam()], now: at("18:59") }))).toBeNull();
    expect(chooseReminder(input({ exams: [exam()], now: at("19:29") }))?.kind).toBe("exam_session");
    expect(chooseReminder(input({ exams: [exam()], now: at("19:30") }))).toBeNull();
  });

  it("uses the daily time for an exam with no study times of its own", () => {
    const reminder = chooseReminder(input({ exams: [exam({ studyWindows: [] })] }));
    expect(reminder?.kind).toBe("exam_session");
  });

  it("says nothing when no exam cards are ready or the exam has passed", () => {
    expect(chooseReminder(input({ exams: [exam({ readyNow: 0 })] }))).toBeNull();
    expect(chooseReminder(input({ exams: [exam({ examAt: at("12:00") })] }))).toBeNull();
  });

  it("never sends the same reminder twice", () => {
    const first = chooseReminder(input({ exams: [exam()] }))!;
    const again = chooseReminder(
      input({
        exams: [exam()],
        now: at("19:20"),
        sent: [{ kind: first.kind, dedupeKey: first.dedupeKey, sentAt: at("19:05"), openedAt: null }],
      }),
    );
    expect(again).toBeNull();
  });

  it("keeps quiet during quiet hours, including across midnight", () => {
    const late = exam({ studyWindows: [22 * 60 + 30] });
    expect(chooseReminder(input({ exams: [late], now: at("22:35") }))).toBeNull();
    const early = exam({ studyWindows: [7 * 60] });
    expect(chooseReminder(input({ exams: [early], now: at("07:05") }))).toBeNull();
    const morning = exam({ studyWindows: [8 * 60] });
    expect(chooseReminder(input({ exams: [morning], now: at("08:05") }))?.kind).toBe("exam_session");
  });

  it("reads the clock in the student's timezone", () => {
    // 19:05 in New York is 00:05 UTC the next day.
    const reminder = chooseReminder(
      input({ exams: [exam()], timezone: "America/New_York", now: at("00:05", "2026-11-10") }),
    );
    expect(reminder?.kind).toBe("exam_session");
    expect(reminder?.dedupeKey).toBe("exam_session:bio:2026-11-09:1140");
    expect(chooseReminder(input({ exams: [exam()], timezone: "America/New_York" }))).toBeNull();
  });

  it("does not interrupt someone who has just been studying", () => {
    expect(chooseReminder(input({ exams: [exam()], lastReviewAt: at("19:00") }))).toBeNull();
    expect(chooseReminder(input({ exams: [exam()], lastReviewAt: at("18:50") }))?.kind).toBe(
      "exam_session",
    );
  });

  it("leaves an hour between reminders and stops at two a day", () => {
    const base = { exams: [exam({ studyWindows: [10 * 60, 14 * 60, 19 * 60] })] };
    expect(
      chooseReminder(input({ ...base, now: at("14:05"), sent: [sent("exam_session", at("13:30"))] })),
    ).toBeNull();
    expect(
      chooseReminder(input({ ...base, now: at("14:05"), sent: [sent("exam_session", at("10:05"))] }))
        ?.kind,
    ).toBe("exam_session");
    expect(
      chooseReminder(
        input({
          ...base,
          sent: [sent("exam_session", at("10:05")), sent("exam_session", at("14:05"))],
        }),
      ),
    ).toBeNull();
  });

  it("allows four a day when an exam is within two days", () => {
    const close = exam({ examAt: at("09:00", "2026-11-11"), studyWindows: [19 * 60] });
    const three = [
      sent("exam_session", at("09:05")),
      sent("next_pass", at("12:00")),
      sent("next_pass", at("15:00")),
    ];
    expect(chooseReminder(input({ exams: [close], sent: three }))?.kind).toBe("exam_session");
    expect(
      chooseReminder(input({ exams: [close], sent: [...three, sent("next_pass", at("17:00"))] })),
    ).toBeNull();
  });

  it("counts the day from the study day's start, not midnight", () => {
    // Two reminders late last night belong to yesterday's study day.
    const lastNight = [
      sent("exam_session", at("20:00", "2026-11-08")),
      sent("daily_reviews", at("21:30", "2026-11-08")),
    ];
    expect(chooseReminder(input({ exams: [exam()], sent: lastNight }))?.kind).toBe("exam_session");
  });

  it("says when the plan is heading well below the target, instead of the usual reminder", () => {
    const reminder = chooseReminder(input({ exams: [exam()], projectedRecall: () => 0.82 }));
    expect(reminder).toMatchObject({
      kind: "behind",
      title: "Bio final is heading for 82%",
      body: "Your target is 90%. Ready now: 24 cards · about 8 min.",
      dedupeKey: "behind:bio:2026-11-09",
    });
    // Within five points of the target is on track enough.
    expect(chooseReminder(input({ exams: [exam()], projectedRecall: () => 0.86 }))?.kind).toBe(
      "exam_session",
    );
  });

  it("asks for a forecast only at a study time", () => {
    let asked = 0;
    const projectedRecall = () => {
      asked++;
      return 0.5;
    };
    chooseReminder(input({ exams: [exam()], now: at("15:00"), projectedRecall }));
    expect(asked).toBe(0);
    chooseReminder(input({ exams: [exam()], projectedRecall }));
    expect(asked).toBe(1);
  });

  it("sends the evening-before reminder once, ahead of anything else", () => {
    const tomorrow = exam({ examAt: at("09:00", "2026-11-10") });
    const reminder = chooseReminder(input({ exams: [tomorrow] }));
    expect(reminder).toMatchObject({
      kind: "lock_in",
      title: "Bio final is tomorrow",
      body: "One pass tonight: 24 cards · about 8 min.",
      dedupeKey: "lock_in:bio",
    });
    // Not in the afternoon, and not a second time.
    expect(chooseReminder(input({ exams: [tomorrow], now: at("15:00") }))).toBeNull();
    const after = chooseReminder(
      input({
        exams: [tomorrow],
        now: at("20:30"),
        sent: [{ kind: "lock_in", dedupeKey: "lock_in:bio", sentAt: at("19:05"), openedAt: null }],
      }),
    );
    expect(after).toBeNull();
  });

  it("sends a warm-up in the last hours before the exam, but not in the last minutes", () => {
    const today = exam({ examAt: at("14:00"), studyWindows: [] });
    const reminder = chooseReminder(input({ exams: [today], now: at("11:30") }));
    expect(reminder).toMatchObject({
      kind: "warm_up",
      title: "Bio final is at 2:00 PM",
      body: "A last look: 24 cards · about 8 min.",
    });
    expect(chooseReminder(input({ exams: [today], now: at("10:30") }))).toBeNull();
    expect(chooseReminder(input({ exams: [today], now: at("13:45") }))).toBeNull();
  });

  it("offers the next pass close to an exam, ninety minutes after the last session", () => {
    const close = exam({ examAt: at("09:00", "2026-11-10"), studyWindows: [] });
    const studied = { due: 0, minutes: 0, reviewedToday: 30 };
    const reminder = chooseReminder(
      input({ exams: [close], now: at("14:00"), regular: studied, lastReviewAt: at("12:20") }),
    );
    expect(reminder).toMatchObject({
      kind: "next_pass",
      title: "Your next pass is ready",
      body: "Bio final: 24 cards · about 8 min.",
    });
    // Too soon after the last session, or nothing studied yet today.
    expect(
      chooseReminder(
        input({ exams: [close], now: at("14:00"), regular: studied, lastReviewAt: at("13:00") }),
      ),
    ).toBeNull();
    expect(chooseReminder(input({ exams: [close], now: at("14:00") }))).toBeNull();
    // An exam a week away does not get same-day passes.
    expect(
      chooseReminder(
        input({ exams: [exam()], now: at("14:00"), regular: studied, lastReviewAt: at("12:20") }),
      ),
    ).toBeNull();
  });

  it("reminds about regular reviews once, when nothing has been studied today", () => {
    const due = { due: 32, minutes: 11, reviewedToday: 0 };
    expect(chooseReminder(input({ regular: due }))).toMatchObject({
      kind: "daily_reviews",
      title: "32 cards due",
      body: "About 11 min keeps today's reviews on schedule.",
      target: { type: "study" },
      dedupeKey: "daily_reviews:2026-11-09",
    });
    expect(chooseReminder(input({ regular: { ...due, reviewedToday: 5 } }))).toBeNull();
    expect(chooseReminder(input({ regular: { ...due, due: 0 } }))).toBeNull();
    expect(chooseReminder(input({ regular: due, now: at("12:00") }))).toBeNull();
  });

  it("puts an exam ahead of regular reviews at the same time", () => {
    const reminder = chooseReminder(
      input({ exams: [exam()], regular: { due: 32, minutes: 11, reviewedToday: 0 } }),
    );
    expect(reminder?.kind).toBe("exam_session");
  });

  it("respects each switch", () => {
    const both = { exams: [exam()], regular: { due: 32, minutes: 11, reviewedToday: 0 } };
    const prefs = (patch: Partial<typeof DEFAULT_REMINDER_PREFS>) => ({ ...DEFAULT_REMINDER_PREFS, ...patch });
    expect(chooseReminder(input({ ...both, prefs: prefs({ enabled: false }) }))).toBeNull();
    expect(chooseReminder(input({ ...both, prefs: prefs({ examReminders: false }) }))?.kind).toBe(
      "daily_reviews",
    );
    expect(chooseReminder(input({ ...both, prefs: prefs({ dailyReviews: false }) }))?.kind).toBe(
      "exam_session",
    );
  });

  it("sends a kind half as often after three in a row go unopened", () => {
    const ignored = [
      sent("daily_reviews", at("19:05", "2026-11-06")),
      sent("daily_reviews", at("19:05", "2026-11-07")),
      sent("daily_reviews", at("19:05", "2026-11-08")),
    ];
    const due = { due: 32, minutes: 11, reviewedToday: 0 };
    // Sent yesterday and ignored three times running: skip today.
    expect(chooseReminder(input({ regular: due, sent: ignored }))).toBeNull();
    // The day after, it goes out again.
    expect(
      chooseReminder(input({ regular: due, sent: ignored, now: at("19:05", "2026-11-10") }))?.kind,
    ).toBe("daily_reviews");
    // Opening one of them lifts the back-off.
    const opened = ignored.map((reminder, index) =>
      index === 1 ? { ...reminder, openedAt: at("19:10", "2026-11-07") } : reminder,
    );
    expect(chooseReminder(input({ regular: due, sent: opened }))?.kind).toBe("daily_reviews");
  });

  it("does not thin out the evening-before reminder", () => {
    const tomorrow = exam({ examAt: at("09:00", "2026-11-10") });
    const ignored = [
      sent("lock_in", at("19:05", "2026-11-02")),
      sent("lock_in", at("19:05", "2026-11-05")),
      sent("lock_in", at("19:05", "2026-11-08")),
    ];
    expect(chooseReminder(input({ exams: [tomorrow], sent: ignored }))?.kind).toBe("lock_in");
  });
});

describe("nextReminderCheck", () => {
  it("comes back in five minutes during the day", () => {
    const next = nextReminderCheck(input({ now: at("15:00") }));
    expect(next.getTime() - at("15:00").getTime()).toBe(5 * 60_000);
  });

  it("skips to the end of quiet hours", () => {
    expect(nextReminderCheck(input({ now: at("23:30") }))).toEqual(at("08:00", "2026-11-10"));
    expect(nextReminderCheck(input({ now: at("03:00") }))).toEqual(at("08:00"));
  });

  it("skips to the next study day once the day's reminders are spent", () => {
    const spent = [sent("exam_session", at("10:05")), sent("daily_reviews", at("14:05"))];
    const next = nextReminderCheck(input({ now: at("15:00"), sent: spent }));
    expect(next).toEqual(at("04:00", "2026-11-10"));
  });

  it("rarely looks at someone who has reminders off", () => {
    const next = nextReminderCheck(
      input({ now: at("15:00"), prefs: { ...DEFAULT_REMINDER_PREFS, enabled: false } }),
    );
    expect(next.getTime() - at("15:00").getTime()).toBe(6 * HOUR);
    expect(DAY).toBe(24 * HOUR);
  });
});
