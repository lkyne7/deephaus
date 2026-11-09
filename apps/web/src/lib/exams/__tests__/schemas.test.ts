import { describe, expect, it } from "vitest";
import {
  createExamSchema,
  examActionSchema,
  previewExamSchema,
  updateExamSchema,
} from "@/lib/exams/schemas";

const deck = "20000000-0000-4000-8000-000000000001";
const base = { name: " Bio final ", exam_at: "2027-01-10T09:00:00+00:00", deck_ids: [deck] };

describe("exam request schemas", () => {
  it("fills in the defaults a new exam does not state", () => {
    expect(createExamSchema.parse(base)).toEqual({
      name: "Bio final",
      exam_at: base.exam_at,
      timezone: "UTC",
      has_time: false,
      target_recall: 0.9,
      daily_minutes_cap: null,
      study_windows: [],
      selection_spec: { deck_ids: [deck], source_ids: [], chunk_ids: [], tags: [], card_ids: [] },
    });
  });

  it("keeps what the student chose, tidied", () => {
    const parsed = createExamSchema.parse({
      ...base,
      timezone: "Europe/Dublin",
      has_time: true,
      target_recall: 0.85,
      daily_minutes_cap: 20,
      study_windows: [1140, 480, 480],
      tags: ["week1", " week1 ", "week2"],
    });
    expect(parsed).toMatchObject({
      timezone: "Europe/Dublin",
      has_time: true,
      target_recall: 0.85,
      daily_minutes_cap: 20,
      study_windows: [480, 1140],
    });
    expect(parsed.selection_spec.tags).toEqual(["week1", "week2"]);
  });

  it("rejects settings outside what an exam allows", () => {
    for (const bad of [
      { target_recall: 0.5 },
      { target_recall: 0.99 },
      { daily_minutes_cap: 0 },
      { daily_minutes_cap: 721 },
      { timezone: "Mars/Olympus" },
      { exam_at: "next tuesday" },
      { name: "  " },
      { deck_ids: ["not-a-uuid"] },
      { study_windows: [1440] },
    ]) {
      expect(createExamSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("does not let a caller choose cards or chunks directly", () => {
    const parsed = createExamSchema.parse({ ...base, card_ids: [deck], chunk_ids: [deck] });
    expect(parsed.selection_spec.card_ids).toEqual([]);
    expect(parsed.selection_spec.chunk_ids).toEqual([]);
  });

  it("updates only what was sent, and needs something to change", () => {
    expect(updateExamSchema.parse({ daily_minutes_cap: null })).toEqual({ daily_minutes_cap: null });
    expect(updateExamSchema.parse({ result_score: 72.5 })).toEqual({ result_score: 72.5 });
    expect(updateExamSchema.parse({ tags: ["week1"] })).toEqual({
      selection_spec: { deck_ids: [], source_ids: [], chunk_ids: [], tags: ["week1"], card_ids: [] },
    });
    expect(updateExamSchema.safeParse({}).success).toBe(false);
    expect(updateExamSchema.safeParse({ result_score: 101 }).success).toBe(false);
  });

  it("previews without a name", () => {
    expect(previewExamSchema.parse({ exam_at: base.exam_at, deck_ids: [deck] })).toMatchObject({
      target_recall: 0.9,
      daily_minutes_cap: null,
      timezone: "UTC",
    });
  });

  it("knows the three exam actions", () => {
    expect(examActionSchema.safeParse({ action: "suspend_cards" }).success).toBe(true);
    expect(examActionSchema.safeParse({ action: "pause" }).success).toBe(false);
  });
});
