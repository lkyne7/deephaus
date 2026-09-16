let offsetMs = 0;
/** Only call with our API's Date header; slow responses cannot calibrate the clock. */
export function observeServerClock(
  date: string | null,
  sentAt: number,
  receivedAt = Date.now(),
) {
  if (!date || receivedAt - sentAt > 10_000 || receivedAt < sentAt) return;
  const server = Date.parse(date);
  if (!Number.isFinite(server)) return;
  offsetMs = server - (sentAt + receivedAt) / 2;
}
export function studyNow() {
  return new Date(Date.now() + offsetMs);
}
export function studyClockOffset() {
  return offsetMs;
}
