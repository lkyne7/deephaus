// Minimum number of review log entries required before the optimizer is
// allowed to run. Below this, FSRS parameter fitting is unstable and we
// just keep the ts-fsrs defaults.
export const OPTIMIZER_MIN_LOGS = 100;
