/** Poll immediately and never overlap requests when a connection is slow. */
export function startSerialPolling(
  tick: () => Promise<void>,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } finally {
      busy = false;
    }
  };
  void run();
  return setInterval(() => {
    void run();
  }, intervalMs);
}
