import {
  HOUR_MS,
  MINUTE_MS,
  clonePlannerState,
  createPlannerState,
  type PlannerState,
} from "./planner.js";
import {
  seededRandom,
  simulateToExam,
  type SimulationOptions,
  type SimulationResult,
} from "./simulate.js";
import type { ExamContext, ExamPlan, ExamPlanDay, ExamScorePoint, ExamSpec, ExamUnit } from "./types.js";

/** Hours after the study day starts: 18:00 for the default 04:00 rollover. */
const SESSION_OFFSETS_HOURS = [14];
/** Morning, midday and evening passes once the exam is within lock-in. */
const LOCK_IN_SESSION_OFFSETS_HOURS = [4, 9, 15];
const CURVE_MINUTES = [10, 20, 30, 45, 60];
/** Small exams are noisy to simulate, so they are averaged over more runs. */
const SIMULATED_REVIEWS_TARGET = 600;
const MAX_RUNS = 8;

/**
 * When a student following the plan sits down: once a day, three times a day
 * in lock-in, and always once before the exam on the day itself.
 */
export function defaultSessions(state: PlannerState, nowMs: number): SimulationOptions["sessions"] {
  return (day) => {
    const lockInDay = day.nextDayStartMs > state.examMs - state.policy.lockInHours * HOUR_MS;
    const offsets = lockInDay ? LOCK_IN_SESSION_OFFSETS_HOURS : SESSION_OFFSETS_HOURS;
    let times = offsets
      .map((hours) => day.dayStartMs + hours * HOUR_MS)
      .filter((at) => at < state.examMs);
    if (day.isToday) {
      times = times.filter((at) => at >= nowMs);
      const first = times[0];
      if (first === undefined || (lockInDay && first - nowMs > 2 * HOUR_MS)) times.unshift(nowMs);
    }
    const examDay = day.nextDayStartMs >= state.examMs;
    if (examDay && !times.some((at) => at <= state.examMs - 30 * MINUTE_MS)) {
      times.push(Math.max(nowMs, state.examMs - 60 * MINUTE_MS));
    }
    return times;
  };
}

function dateKey(ms: number, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function averageRuns(runs: SimulationResult[]): SimulationResult {
  const first = runs[0]!;
  const mean = (pick: (run: SimulationResult) => number) =>
    runs.reduce((sum, run) => sum + pick(run), 0) / runs.length;
  return {
    days: first.days.map((day, index) => ({
      dayStartMs: day.dayStartMs,
      reviews: mean((run) => run.days[index]?.reviews ?? 0),
      newCards: mean((run) => run.days[index]?.newCards ?? 0),
      recallAtExam: mean((run) => run.days[index]?.recallAtExam ?? 0),
    })),
    reviews: mean((run) => run.reviews),
    recallAtExam: mean((run) => run.recallAtExam),
    shareAtTarget: mean((run) => run.shareAtTarget),
    unseen: mean((run) => run.unseen),
  };
}

export interface PlanExamOptions {
  /** Skip the time-versus-score curve, which costs five extra forecasts. */
  curve?: boolean;
  seed?: number;
}

/**
 * Forecast the days up to the exam by playing the queue forward with a
 * simulated student: what each day asks for, where recall ends up, and what
 * other daily time budgets would buy.
 */
export function planExam(
  units: readonly ExamUnit[],
  exam: ExamSpec,
  context: ExamContext,
  options: PlanExamOptions = {},
): ExamPlan {
  const base = createPlannerState(units, exam, context);
  const nowMs = context.now.getTime();
  const seed = options.seed ?? 1337;
  const runs = Math.max(
    1,
    Math.min(MAX_RUNS, Math.ceil(SIMULATED_REVIEWS_TARGET / Math.max(1, base.units.length))),
  );
  const perMinute = 60 / base.secondsPerReview;

  const forecast = (capMinutes: number | null): SimulationResult => {
    const results: SimulationResult[] = [];
    for (let run = 0; run < runs; run++) {
      const state = clonePlannerState(base);
      state.capReviewsPerDay =
        capMinutes === null ? null : Math.max(1, Math.floor(capMinutes * perMinute));
      results.push(
        simulateToExam(state, {
          nowMs,
          random: seededRandom(seed + run * 7919),
          sessions: defaultSessions(state, nowMs),
        }),
      );
    }
    return averageRuns(results);
  };

  const uncapped = forecast(null);
  const main = exam.dailyMinutesCap == null ? uncapped : forecast(exam.dailyMinutesCap);

  const neededMinutes = uncapped.days
    .map((day) => day.reviews / perMinute)
    .filter((minutes) => minutes >= 0.5)
    .sort((a, b) => a - b);
  const peakMinutes = neededMinutes[neededMinutes.length - 1] ?? 0;
  const typicalMinutes = neededMinutes[Math.floor(neededMinutes.length / 2)] ?? 0;

  const curve: ExamScorePoint[] = [];
  if (options.curve !== false) {
    for (const minutes of CURVE_MINUTES) {
      // A budget above the heaviest day changes nothing.
      const result = minutes >= peakMinutes ? uncapped : forecast(minutes);
      curve.push({ minutesPerDay: minutes, recallAtExam: result.recallAtExam });
    }
    curve.push({ minutesPerDay: null, recallAtExam: uncapped.recallAtExam });
  }

  const days: ExamPlanDay[] = main.days.map((day) => ({
    date: dateKey(day.dayStartMs + HOUR_MS, base.timezone),
    reviews: Math.round(day.reviews),
    newCards: Math.round(day.newCards),
    minutes: Math.round(day.reviews / perMinute),
    recallAtExam: day.recallAtExam,
  }));

  return {
    days,
    projected: {
      recallAtExam: main.recallAtExam,
      shareAtTarget: main.shareAtTarget,
      unseen: Math.round(main.unseen),
    },
    onTrack: main.recallAtExam >= exam.targetRecall - 0.005,
    needed: {
      typicalMinutes: Math.ceil(typicalMinutes),
      peakMinutes: Math.ceil(peakMinutes),
      totalMinutes: Math.ceil(uncapped.reviews / perMinute),
    },
    curve,
  };
}
