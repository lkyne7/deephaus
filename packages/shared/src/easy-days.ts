import { z } from "zod";

export const EASY_DAY_LEVELS = ["minimum", "reduced", "normal"] as const;
export const EASY_DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export type EasyDayLevel = (typeof EASY_DAY_LEVELS)[number];
/** Monday first. Weights redistribute future reviews, not daily quotas. */
export type EasyDays = EasyDayLevel[];
export const normalEasyDays = (): EasyDays => Array(7).fill("normal");
export const weekendWarriorDays = (): EasyDays => [
  "normal",
  "normal",
  "normal",
  "normal",
  "normal",
  "reduced",
  "reduced",
];
export const easyDaysSchema = z
  .array(z.enum(EASY_DAY_LEVELS))
  .length(7)
  .refine(
    (days) => days.includes("normal"),
    "Keep at least one day set to Normal.",
  );

export function parseEasyDays(raw: unknown): EasyDays {
  try {
    const parsed = easyDaysSchema.safeParse(
      typeof raw === "string" ? JSON.parse(raw) : raw,
    );
    return parsed.success ? parsed.data : normalEasyDays();
  } catch {
    return normalEasyDays();
  }
}

export const EASY_DAYS_DESCRIPTION =
  "Choose a lighter review load on specific days across all decks. Future review dates shift slightly toward your normal days. Existing due cards, short learning steps, and cram plans stay unchanged.";
