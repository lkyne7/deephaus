export interface CleanupBucket {
  list(
    path: string,
    options: { limit: number; sortBy: { column: string; order: string } },
  ): PromiseLike<{
    data: { id?: string | null; name: string }[] | null;
    error: { message: string } | null;
  }>;
  remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
}
/** Delete pages in place: offsets would skip files as earlier pages disappear. */
export async function removeStorageTree(
  bucket: CleanupBucket,
  prefix: string,
  deadline = Infinity,
): Promise<void> {
  for (;;) {
    if (Date.now() >= deadline)
      throw new Error("Cleanup will continue in the background.");
    const { data, error } = await bucket.list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Storage listing returned no result.");
    if (!data.length) return;
    const files = data
      .filter((entry) => entry.id)
      .map((entry) => `${prefix}/${entry.name}`);
    for (let i = 0; i < files.length; i += 100) {
      const removed = await bucket.remove(files.slice(i, i + 100));
      if (removed.error) throw new Error(removed.error.message);
    }
    for (const folder of data.filter((entry) => !entry.id))
      await removeStorageTree(bucket, `${prefix}/${folder.name}`, deadline);
  }
}
