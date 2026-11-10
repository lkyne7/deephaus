/**
 * A small in-memory PostgREST client covering the calls the community lib
 * makes, so publish, add and sync can be tested end to end without a database.
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

// Joins used by the community queries, resolved against the fake tables.
const RELATIONS: Record<string, Record<string, { table: string; key: string }>> = {
  cards: { generation_jobs: { table: "generation_jobs", key: "job_id" } },
  generation_jobs: { sources: { table: "sources", key: "source_id" } },
};

// Column defaults the real tables fill in.
const DEFAULTS: Record<string, Row> = {
  deck_publications: { version: 1, subscriber_count: 0, avg_rating: 0, rating_count: 0 },
};

// `on delete cascade` foreign keys that matter here: a deleted card takes its
// review history and its link to a published card with it.
const CASCADES: Record<string, Array<{ table: string; key: string }>> = {
  cards: [
    { table: "card_reviews", key: "card_id" },
    { table: "deck_subscription_cards", key: "local_card_id" },
  ],
  deck_subscriptions: [{ table: "deck_subscription_cards", key: "subscription_id" }],
};

type FakeError = { message: string; code?: string };

export type FakeOptions = {
  /** Tables that don't exist yet, as before a migration is applied. */
  missingTables?: string[];
  /** Columns that don't exist yet, per table. */
  missingColumns?: Record<string, string[]>;
};

/** Top-level selected columns; embedded resources like `x!inner(...)` are skipped. */
function selectedColumns(select: string): string[] | null {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      columns.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  columns.push(current.trim());
  if (columns.includes("*")) return null;
  return columns.filter((column) => column && !column.includes("("));
}

function compare(a: unknown, b: unknown): number {
  if (a == null || b == null) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function fakeSupabase(tables: Tables, options: FakeOptions = {}) {
  let nextId = 1;

  const resolve = (table: string, row: Row, path: string): unknown => {
    const [head, ...rest] = path.split(".");
    if (rest.length === 0) return row[head];
    const relation = RELATIONS[table]?.[head];
    if (!relation) throw new Error(`Unknown relation ${table}.${head}`);
    const related = (tables[relation.table] ?? []).find((r) => r.id === row[relation.key]);
    return related ? resolve(relation.table, related, rest.join(".")) : undefined;
  };

  const remove = (table: string, rows: Row[]) => {
    if (rows.length === 0) return;
    tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
    for (const cascade of CASCADES[table] ?? []) {
      const ids = rows.map((row) => row.id);
      remove(
        cascade.table,
        (tables[cascade.table] ?? []).filter((row) => ids.includes(row[cascade.key])),
      );
    }
  };

  const schemaError = (table: string, written: Row[]): FakeError | null => {
    if (options.missingTables?.includes(table)) {
      return { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` };
    }
    const missing = (options.missingColumns?.[table] ?? []).find((column) =>
      written.some((row) => column in row),
    );
    return missing
      ? { code: "PGRST204", message: `Could not find the '${missing}' column of '${table}' in the schema cache` }
      : null;
  };

  function builder(table: string) {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let columns: string[] | null = null;
    let payload: Row[] = [];
    let patch: Row = {};
    let conflictKeys: string[] = [];
    let limit: number | null = null;
    let range: [number, number] | null = null;
    const orders: Array<{ column: string; ascending: boolean }> = [];
    const filters: Array<(row: Row) => boolean> = [];

    const run = (): { rows: Row[]; error: FakeError | null } => {
      const error = schemaError(table, op === "update" ? [patch] : payload);
      if (error) return { rows: [], error };

      tables[table] ??= [];
      let rows: Row[];
      if (op === "insert") {
        rows = payload.map((row) => ({ id: `${table}-${nextId++}`, ...DEFAULTS[table], ...row }));
        tables[table].push(...rows);
      } else if (op === "upsert") {
        rows = payload.map((row) => {
          const existing = tables[table].find((r) => conflictKeys.every((key) => r[key] === row[key]));
          if (existing) return Object.assign(existing, row);
          const created = { id: `${table}-${nextId++}`, ...row };
          tables[table].push(created);
          return created;
        });
      } else {
        rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (op === "update") for (const row of rows) Object.assign(row, patch);
        if (op === "delete") remove(table, rows);
      }
      for (const { column, ascending } of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit != null) rows = rows.slice(0, limit);
      return {
        rows: rows.map((row) =>
          columns ? Object.fromEntries(columns.map((column) => [column, row[column]])) : { ...row },
        ),
        error: null,
      };
    };

    const query: Record<string, unknown> = {
      select: (select = "*") => {
        columns = selectedColumns(select);
        return query;
      },
      insert: (rows: Row | Row[]) => {
        op = "insert";
        payload = Array.isArray(rows) ? rows : [rows];
        return query;
      },
      upsert: (rows: Row | Row[], opts?: { onConflict?: string }) => {
        op = "upsert";
        payload = Array.isArray(rows) ? rows : [rows];
        conflictKeys = (opts?.onConflict ?? "id").split(",").map((key) => key.trim());
        return query;
      },
      update: (values: Row) => {
        op = "update";
        patch = values;
        return query;
      },
      delete: () => {
        op = "delete";
        return query;
      },
      eq: (path: string, value: unknown) => {
        filters.push((row) => resolve(table, row, path) === value);
        return query;
      },
      in: (path: string, values: unknown[]) => {
        filters.push((row) => values.includes(resolve(table, row, path)));
        return query;
      },
      order: (column: string, opts?: { ascending?: boolean }) => {
        orders.push({ column, ascending: opts?.ascending ?? true });
        return query;
      },
      limit: (n: number) => {
        limit = n;
        return query;
      },
      range: (from: number, to: number) => {
        range = [from, to];
        return query;
      },
      single: async () => {
        const { rows, error } = run();
        if (error) return { data: null, error };
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: `expected one ${table} row` } };
      },
      maybeSingle: async () => {
        const { rows, error } = run();
        return { data: error ? null : (rows[0] ?? null), error };
      },
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            const { rows, error } = run();
            return { data: error ? null : rows, error };
          })
          .then(onFulfilled, onRejected),
    };
    return query;
  }

  return { from: (table: string) => builder(table) };
}

/** The ids of a deck's cards, through its sources and jobs. */
export function projectCards(tables: Tables, projectId: unknown): Row[] {
  const sourceIds = tables.sources.filter((s) => s.project_id === projectId).map((s) => s.id);
  const jobIds = tables.generation_jobs.filter((j) => sourceIds.includes(j.source_id)).map((j) => j.id);
  return tables.cards.filter((card) => jobIds.includes(card.job_id));
}
