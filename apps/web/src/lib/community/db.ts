type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every row of a query, a page at a time. PostgREST caps a response
 * (1,000 rows by default), and a sync that compares two lists must not work
 * from a list that was silently cut short. The query needs a stable order.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** Split a list for `.in()` filters and bulk writes, which have size limits. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * True when a write failed only because a column or table from the Community
 * listing migration isn't there yet. The feature then runs without it, so the
 * app can be deployed before the migration is applied.
 */
export function isMissingSchema(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "PGRST205" || error.code === "PGRST202") return true;
  if (error.code === "42703" || error.code === "42P01" || error.code === "42883") return true;
  return /could not find the .* (column|table|function)|does not exist/i.test(error.message ?? "");
}
