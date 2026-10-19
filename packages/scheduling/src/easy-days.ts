import { parseEasyDays, type EasyDays } from "@deephaus/shared";
import { Rating, State, type IPreview } from "ts-fsrs";

export type EasyDaysOptions = {
  easyDays?: EasyDays;
  timezone?: string | null;
  dayStartHour?: number;
};
const DAY = 86_400_000;
const weights = { minimum: 0.05, reduced: 0.5, normal: 1 };

/** Study weekday in the saved IANA timezone, with the user's rollover hour. */
export function studyWeekday(
  date: Date,
  timezone = "UTC",
  dayStartHour = 4,
): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return studyWeekday(date, "UTC", dayStartHour);
  }
  const get = (name: string) =>
    Number(parts.find((p) => p.type === name)?.value);
  const localDay = new Date(
    Date.UTC(get("year"), get("month") - 1, get("day")),
  );
  if (get("hour") < dayStartHour)
    localDay.setUTCDate(localDay.getUTCDate() - 1);
  return (localDay.getUTCDay() + 6) % 7;
}

function randomFraction(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++)
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

/**
 * Move a fraction of reviews off light days, within ±10% (1–3 days).
 * Preserve grade ordering, FSRS memory estimates and the historical review log.
 * Deterministic for a given FSRS result so previews and committed grades agree.
 */
export function applyEasyDays(
  preview: IPreview,
  options: EasyDaysOptions,
): IPreview {
  const days = parseEasyDays(options.easyDays);
  if (days.every((day) => day === "normal")) return preview;
  const grades = [Rating.Hard, Rating.Good, Rating.Easy] as const;
  const original = grades.map((grade) => preview[grade].card.scheduled_days);
  for (let index = 0; index < grades.length; index++) {
    const grade = grades[index];
    const card = preview[grade].card;
    const interval = original[index];
    if (card.state !== State.Review || interval < 3) continue;
    const currentWeight =
      weights[
        days[
          studyWeekday(
            card.due,
            options.timezone ?? "UTC",
            options.dayStartHour,
          )
        ]
      ];
    if (currentWeight === 1) continue;
    const radius = Math.min(3, Math.max(1, Math.floor(interval * 0.1)));
    // Midpoints stop independently adjusted button intervals crossing each other.
    const min = Math.max(
      1,
      interval - radius,
      index > 0 ? Math.ceil((original[index - 1] + interval) / 2) : 1,
    );
    const max = Math.min(
      36500,
      interval + radius,
      index < 2 ? Math.floor((interval + original[index + 1]) / 2) : 36500,
    );
    const candidates: { offset: number; weight: number }[] = [];
    for (let next = min; next <= max; next++) {
      const offset = next - interval;
      const due = new Date(card.due.getTime() + offset * DAY);
      const weight =
        weights[
          days[
            studyWeekday(due, options.timezone ?? "UTC", options.dayStartHour)
          ]
        ];
      if (weight > currentWeight) candidates.push({ offset, weight });
    }
    if (!candidates.length) continue;
    const bestWeight = Math.max(...candidates.map((c) => c.weight));
    const seed = `${card.last_review?.getTime()}:${card.due.getTime()}:${card.stability}:${card.reps}:${grade}`;
    if (randomFraction(seed) < currentWeight / bestWeight) continue;
    const preferred = candidates.filter((c) => c.weight === bestWeight);
    const distance = Math.min(...preferred.map((c) => Math.abs(c.offset)));
    const closest = preferred.filter((c) => Math.abs(c.offset) === distance);
    const selected =
      closest[Math.floor(randomFraction(`${seed}:direction`) * closest.length)];
    card.due = new Date(card.due.getTime() + selected.offset * DAY);
    card.scheduled_days = interval + selected.offset;
  }
  return preview;
}
