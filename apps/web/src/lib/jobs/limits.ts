const MAX_ACTIVE_JOBS_PER_USER = 3;

export { MAX_ACTIVE_JOBS_PER_USER };

export function isJobTerminal(status: string): boolean {
  return status === "ready" || status === "failed";
}
