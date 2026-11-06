import { describe, expect, it } from "vitest";
import {
  averageDailyReviews,
  DAILY_BUDGET_STOPS,
  daysLeftLabel,
  formatDeadlineLong,
  formatDeadlineShort,
  groupPlans,
  nearestBudgetStop,
  plainPreview,
  previewRuns,
  readinessHero,
  summarizeToday,
  todayProgress,
  type CramPlan,
  type CramPlanStatus,
} from "../types";

const NOW = new Date("2026-11-05T15:00:00Z");
const TORONTO = { viewerTimeZone: "America/Toronto", now: NOW, locale: "en-US" };

function plan(id: string, status: CramPlanStatus, deadline: string, extra: Partial<CramPlan> = {}): CramPlan {
  return { id, status, deadline_at: deadline, ...extra };
}

describe("plainPreview", () => {
  it("strips markdown emphasis", () => {
    expect(plainPreview("What happens in **metaphase**?")).toBe("What happens in metaphase?");
    expect(plainPreview("An *italic* and _underscored_ word")).toBe("An italic and underscored word");
    expect(plainPreview("Use `code` and ~~gone~~ text")).toBe("Use code and gone text");
  });

  it("strips html, clozes, links and math delimiters", () => {
    expect(plainPreview("<p>The <em>cell</em> &amp; nucleus</p>")).toBe("The cell & nucleus");
    expect(plainPreview("{{c1::Mitosis::process}} divides {{c2::cells}}")).toBe("Mitosis divides cells");
    expect(plainPreview("See [the chart](https://example.com/a)")).toBe("See the chart");
    expect(plainPreview("What does the coefficient $r$ tell us?")).toBe("What does the coefficient r tell us?");
  });

  it("leaves text that only looks like markup", () => {
    expect(plainPreview("It costs $5 and $10")).toBe("It costs $5 and $10");
    expect(plainPreview("Is 3 < 4 and 2*3*4 = 24?")).toBe("Is 3 < 4 and 2*3*4 = 24?");
  });

  it("names media instead of printing its markup", () => {
    expect(plainPreview("Label this ![](https://example.com/a.png)")).toBe("Label this [image]");
  });

  it("handles empty input", () => {
    expect(plainPreview(null)).toBe("");
    expect(plainPreview("")).toBe("");
  });
});

describe("previewRuns", () => {
  it("keeps bold as runs", () => {
    expect(previewRuns("What happens in **metaphase**?")).toEqual([
      { text: "What happens in ", strong: false },
      { text: "metaphase", strong: true },
      { text: "?", strong: false },
    ]);
    expect(previewRuns("<b>Bold</b> html")).toEqual([
      { text: "Bold", strong: true },
      { text: " html", strong: false },
    ]);
  });

  it("drops unbalanced markers", () => {
    expect(previewRuns("An open ** marker")).toEqual([{ text: "An open  marker", strong: false }]);
  });
});

describe("deadline formatting", () => {
  it("shows only the date for a deadline without an exact time", () => {
    expect(
      formatDeadlineLong("2026-11-13T01:21:00.651Z", { ...TORONTO, timezone: "UTC", hasTime: false }),
    ).toBe("Friday, Nov 13");
  });

  it("keeps the calendar day the user picked in the plan's zone", () => {
    expect(
      formatDeadlineLong("2026-11-14T04:59:59Z", {
        ...TORONTO,
        viewerTimeZone: "Asia/Tokyo",
        timezone: "America/Toronto",
        hasTime: false,
      }),
    ).toBe("Friday, Nov 13");
  });

  it("shows an exact time in the viewer's zone when they match", () => {
    expect(
      formatDeadlineLong("2026-11-13T14:00:00Z", { ...TORONTO, timezone: "America/Toronto", hasTime: true }),
    ).toBe("Friday, Nov 13 at 9:00 AM");
  });

  it("reads a UTC exact time in the viewer's own time", () => {
    expect(
      formatDeadlineLong("2026-11-13T01:21:00Z", { ...TORONTO, timezone: "UTC", hasTime: true }),
    ).toBe("Thursday, Nov 12 at 8:21 PM");
  });

  it("names another place's zone", () => {
    expect(
      formatDeadlineLong("2026-11-13T00:00:00Z", { ...TORONTO, timezone: "Asia/Tokyo", hasTime: true }),
    ).toBe("Friday, Nov 13 at 9:00 AM Tokyo time");
    expect(
      formatDeadlineLong("2026-11-13T14:00:00Z", { ...TORONTO, timezone: "America/New_York", hasTime: true }),
    ).toBe("Friday, Nov 13 at 9:00 AM New York time");
  });

  it("adds the year only when it differs", () => {
    expect(formatDeadlineShort("2026-11-13T12:00:00Z", { ...TORONTO, timezone: "UTC" })).toBe("Nov 13");
    expect(formatDeadlineShort("2027-01-02T12:00:00Z", { ...TORONTO, timezone: "UTC" })).toBe("Jan 2, 2027");
  });

  it("survives bad input", () => {
    expect(formatDeadlineLong("nope", TORONTO)).toBe("Invalid deadline");
    expect(formatDeadlineLong("2026-11-13T12:00:00Z", { ...TORONTO, timezone: "Mars/Base" })).toContain("Nov 13");
  });
});

describe("daysLeftLabel", () => {
  it("counts calendar days in the plan's zone", () => {
    expect(daysLeftLabel("2026-11-14T04:59:59Z", "America/Toronto", NOW)).toBe("8 days left");
    expect(daysLeftLabel("2026-11-06T04:59:59Z", "America/Toronto", NOW)).toBe("Due today");
    expect(daysLeftLabel("2026-11-07T04:59:59Z", "America/Toronto", NOW)).toBe("Due tomorrow");
  });

  it("says when the deadline has gone", () => {
    expect(daysLeftLabel("2026-11-05T14:59:59Z", "America/Toronto", NOW)).toBe("Deadline passed");
  });
});

describe("groupPlans", () => {
  it("puts active first by soonest deadline and finished latest first", () => {
    const groups = groupPlans([
      plan("a2", "active", "2026-11-20T00:00:00Z"),
      plan("done1", "completed", "2026-11-01T00:00:00Z"),
      plan("a1", "active", "2026-11-13T00:00:00Z"),
      plan("arch", "archived", "2026-11-03T00:00:00Z"),
      plan("p", "paused", "2026-11-13T00:00:00Z"),
      plan("d", "draft", "2026-11-13T00:00:00Z"),
    ]);
    expect(groups.active.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(groups.paused.map((item) => item.id)).toEqual(["p"]);
    expect(groups.drafts.map((item) => item.id)).toEqual(["d"]);
    expect(groups.finished.map((item) => item.id)).toEqual(["arch", "done1"]);
  });

  it("sorts plans without a deadline last", () => {
    const groups = groupPlans([
      { id: "none", status: "active" },
      plan("dated", "active", "2026-11-13T00:00:00Z"),
    ]);
    expect(groups.active.map((item) => item.id)).toEqual(["dated", "none"]);
  });
});

describe("summarizeToday", () => {
  const today = (remaining: number, seconds = 30) => ({
    review_capacity: 90,
    reviews_completed: 0,
    reviews_remaining: remaining,
    estimated_seconds_per_review: seconds,
  });

  it("totals active plans and starts with the soonest that has cards left", () => {
    const summary = summarizeToday([
      plan("later", "active", "2026-11-20T00:00:00Z", { today: today(20) }),
      plan("sooner", "active", "2026-11-13T00:00:00Z", { today: today(18) }),
      plan("finished-today", "active", "2026-11-10T00:00:00Z", { today: today(0) }),
      plan("paused", "paused", "2026-11-10T00:00:00Z", { today: today(50) }),
    ]);
    expect(summary).toMatchObject({ sessions: 3, pendingPlans: 2, remaining: 38, minutes: 19 });
    expect(summary.next?.id).toBe("sooner");
  });

  it("reports nothing left", () => {
    const summary = summarizeToday([plan("a", "active", "2026-11-13T00:00:00Z", { today: today(0) })]);
    expect(summary).toMatchObject({ sessions: 1, remaining: 0, minutes: 0, next: null });
  });
});

describe("todayProgress", () => {
  const today = (reviewsCompleted: number, reviewsRemaining: number | null) => ({
    reviewCapacity: 90,
    reviewsCompleted,
    reviewsRemaining,
    estimatedSecondsPerReview: 20,
    budgetReached: false,
  });

  it("counts done against what's planned", () => {
    expect(todayProgress(today(12, 24))).toBe("12 of 36");
    expect(todayProgress(today(36, 0))).toBe("36 of 36");
  });

  it("doesn't print 0 of 0", () => {
    expect(todayProgress(today(0, 0))).toBe("Nothing due");
    expect(todayProgress(null)).toBe("—");
  });
});

describe("forecast helpers", () => {
  it("averages planned reviews rather than the budget's capacity", () => {
    expect(averageDailyReviews({ estimated_reviews: 192, days_remaining: 8, daily_review_capacity: 90 })).toBe(24);
    expect(averageDailyReviews({ estimated_reviews: 10, days_remaining: 0 })).toBeNull();
    expect(averageDailyReviews(null)).toBeNull();
  });

  it("snaps a typed budget to the nearest slider stop", () => {
    expect(DAILY_BUDGET_STOPS[nearestBudgetStop(30)]).toBe(30);
    expect(DAILY_BUDGET_STOPS[nearestBudgetStop(5)]).toBe(5);
    expect(DAILY_BUDGET_STOPS[nearestBudgetStop(480)]).toBe(480);
    expect(DAILY_BUDGET_STOPS[nearestBudgetStop(70)]).toBe(75);
  });
});

describe("readinessHero", () => {
  const base = {
    current: 74,
    projected: 92,
    target: 90,
    dailyMinutes: 30,
    readyItems: 50,
    totalItems: 65,
    deadlinePassed: false,
  };

  it("says when an active plan is on track", () => {
    const hero = readinessHero({ ...base, status: "active" });
    expect(hero).toMatchObject({ value: 74, label: "Ready now", showChart: true });
    expect(hero.headline).toBe("On track for 92% by your deadline");
  });

  it("doesn't claim on track below the target", () => {
    const hero = readinessHero({ ...base, status: "active", projected: 80 });
    expect(hero.headline).toBe("Heading for 80% by your deadline");
    expect(hero.detail).toContain("short of your 90% target");
  });

  it("leads with the prediction for a draft", () => {
    expect(readinessHero({ ...base, status: "draft", current: 0 })).toMatchObject({
      value: 92,
      label: "Predicted readiness",
    });
  });

  it("has no chart once a plan is finished", () => {
    const hero = readinessHero({ ...base, status: "completed" });
    expect(hero).toMatchObject({ label: "Final readiness", showChart: false });
    expect(hero.detail).toBe("50 of 65 cards reached your 90% target.");
    expect(readinessHero({ ...base, status: "archived" }).showChart).toBe(false);
    expect(readinessHero({ ...base, status: "active", deadlinePassed: true }).showChart).toBe(false);
  });

  it("has no chart without a forecast", () => {
    expect(readinessHero({ ...base, status: "active", projected: null }).showChart).toBe(false);
  });
});
