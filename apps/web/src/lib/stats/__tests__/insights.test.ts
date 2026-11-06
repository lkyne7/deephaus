import { describe, expect, it } from "vitest";
import {
  buildYearWeeks,
  formatInterval,
  groupByWeek,
  heatLevel,
  monthTicks,
  peakOf,
} from "@/lib/stats/insights";

describe("buildYearWeeks", () => {
  const weeks = buildYearWeeks(2026, new Date(2026, 10, 6, 12));
  const cells = weeks.flat();

  it("starts each week on Monday and covers every day of the year", () => {
    expect(weeks.every((week) => week[0].date.getDay() === 1)).toBe(true);
    expect(cells.filter((cell) => cell.inYear)).toHaveLength(365);
  });

  it("marks only days after today as future", () => {
    const inYear = cells.filter((cell) => cell.inYear);
    expect(inYear.filter((cell) => !cell.future).at(-1)?.date.getMonth()).toBe(10);
    expect(inYear.filter((cell) => !cell.future).at(-1)?.date.getDate()).toBe(6);
  });

  it("places twelve month labels in order", () => {
    const ticks = monthTicks(weeks);
    expect(ticks.map((tick) => tick.label)).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
    expect(ticks[0].week).toBe(0);
  });
});

describe("heatLevel", () => {
  it("steps up with the share of the busiest day", () => {
    expect(heatLevel(0, 20)).toBe(0);
    expect(heatLevel(1, 20)).toBe(1);
    expect(heatLevel(6, 20)).toBe(2);
    expect(heatLevel(11, 20)).toBe(3);
    expect(heatLevel(20, 20)).toBe(4);
  });

  it("shows the strongest step when every active day has one review", () => {
    expect(heatLevel(1, 1)).toBe(4);
  });
});

describe("series helpers", () => {
  const days = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    count: index === 8 ? 9 : 1,
  }));

  it("groups days into weeks and keeps the partial week", () => {
    expect(groupByWeek(days)).toEqual([
      { date: "2026-11-01", count: 7 },
      { date: "2026-11-08", count: 11 },
    ]);
  });

  it("finds the busiest day, and none in an empty series", () => {
    expect(peakOf(days)?.date).toBe("2026-11-09");
    expect(peakOf([{ date: "2026-11-01", count: 0 }])).toBeNull();
  });
});

describe("formatInterval", () => {
  it("picks a readable unit", () => {
    expect(formatInterval(null)).toBe("–");
    expect(formatInterval(0.25)).toBe("6h");
    expect(formatInterval(21)).toBe("21d");
    expect(formatInterval(45)).toBe("1.5mo");
    expect(formatInterval(730)).toBe("2.0y");
  });
});
