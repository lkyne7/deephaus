import { Rating } from "ts-fsrs";
import {
  calculateReadiness,
  gradeCramItem,
  reviewCapacity,
  retrievabilityAt,
  sortCramQueue,
} from "@/lib/cram/scheduler";
import { localDateKey, nextLocalDayStart, startOfLocalDay } from "@/lib/cram/time";
import type {
  CramForecast,
  CramPlanItemRow,
} from "@/lib/cram/types";

export interface ForecastOptions {
  items: CramPlanItemRow[];
  deadline: Date;
  deadlineTimezone: string;
  targetRetention: number;
  dailyMinutes: number;
  estimatedSecondsPerReview: number;
  paramsByProject: ReadonlyMap<string, number[]>;
  /** Reviews already logged today — shrinks the first projected day's capacity. */
  reviewsCompletedToday?: number;
  now?: Date;
}

export function forecastCramPlan(options: ForecastOptions): CramForecast {
  const now = options.now ?? new Date();
  const deadline = options.deadline;
  const capacity = reviewCapacity(
    options.dailyMinutes,
    options.estimatedSecondsPerReview,
  );
  const projected = options.items.map((item) => ({ ...item }));
  const daily: CramForecast["daily"] = [];
  let totalReviews = 0;

  if (deadline.getTime() > now.getTime() && capacity > 0) {
    let dayStart = startOfLocalDay(now, options.deadlineTimezone);
    let isFirstDay = true;
    while (dayStart.getTime() < deadline.getTime()) {
      const nextDay = nextLocalDayStart(dayStart, options.deadlineTimezone);
      const midpoint = new Date(dayStart.getTime() + (nextDay.getTime() - dayStart.getTime()) / 2);
      // Clamp into (now, deadline) so a deadline earlier in the day (e.g. a
      // 9am exam) still forecasts that morning's reviews instead of skipping
      // the final day entirely.
      const reviewedAt = new Date(
        Math.max(
          now.getTime(),
          Math.min(midpoint.getTime(), deadline.getTime() - 60_000),
        ),
      );
      if (reviewedAt.getTime() >= deadline.getTime()) break;

      // Today's remaining capacity accounts for reviews already completed.
      const dayCapacity = isFirstDay
        ? Math.max(0, capacity - (options.reviewsCompletedToday ?? 0))
        : capacity;
      isFirstDay = false;

      const candidates = sortCramQueue(
        projected,
        reviewedAt,
        deadline,
        options.targetRetention,
        options.paramsByProject,
      ).filter(
        (item) =>
          item.state === 0 ||
          new Date(item.due).getTime() <= reviewedAt.getTime() ||
          retrievabilityAt(
            item,
            deadline,
            options.paramsByProject.get(item.project_id),
            options.targetRetention,
          ) < options.targetRetention,
      );

      const selected = candidates.slice(0, dayCapacity);
      let newReviews = 0;
      for (const selectedItem of selected) {
        const index = projected.findIndex((item) => item.id === selectedItem.id);
        if (index < 0) continue;
        if (projected[index].state === 0) newReviews++;
        const transition = gradeCramItem(
          projected[index],
          Rating.Good,
          reviewedAt,
          options.targetRetention,
          options.paramsByProject.get(projected[index].project_id),
        );
        projected[index] = {
          ...projected[index],
          ...transition.next,
          version: projected[index].version + 1,
        };
      }

      daily.push({
        date: localDateKey(dayStart, options.deadlineTimezone),
        capacity: dayCapacity,
        scheduled_reviews: selected.length - newReviews,
        new_reviews: newReviews,
        total_reviews: selected.length,
      });
      totalReviews += selected.length;
      dayStart = nextDay;
    }
  }

  const readiness = calculateReadiness(
    projected,
    deadline,
    options.targetRetention,
    options.paramsByProject,
  );
  const initialNew = options.items.filter((item) => item.state === 0).length;
  const initialDue = options.items.filter(
    (item) => item.state !== 0 && new Date(item.due).getTime() <= now.getTime(),
  ).length;
  const totalCapacity = daily.reduce((sum, day) => sum + day.capacity, 0);

  return {
    generated_at: now.toISOString(),
    deadline_at: deadline.toISOString(),
    days_remaining: daily.length,
    item_count: options.items.length,
    new_count: initialNew,
    due_count: initialDue,
    estimated_seconds_per_review: options.estimatedSecondsPerReview,
    daily_review_capacity: capacity,
    total_review_capacity: totalCapacity,
    estimated_reviews: totalReviews,
    estimated_minutes: Math.round(
      (totalReviews * options.estimatedSecondsPerReview) / 60,
    ),
    feasible:
      readiness.unseen_items === 0 &&
      readiness.target_coverage >= 1 &&
      totalReviews <= totalCapacity,
    readiness,
    daily,
  };
}
