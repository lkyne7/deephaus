/** Node.js-only memory helpers — do not import from Edge middleware. */
export function memorySnapshotMb() {
  if (typeof process === "undefined" || !process.memoryUsage) {
    return { heapUsedMb: undefined, rssMb: undefined };
  }
  const mem = process.memoryUsage();
  return {
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
  };
}
