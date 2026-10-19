import { describe, expect, it } from "vitest";
import { publishProject } from "@/lib/community/publish";
import { subscribeToPublication, syncFollowSubscriptionIfNeeded } from "@/lib/community/subscribe";

type Row = Record<string, unknown>;

// Joins used by the community queries, resolved against the fake tables.
const RELATIONS: Record<string, Record<string, { table: string; key: string }>> = {
  cards: { generation_jobs: { table: "generation_jobs", key: "job_id" } },
  generation_jobs: { sources: { table: "sources", key: "source_id" } },
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

/** Minimal in-memory PostgREST client covering the calls the community lib makes. */
function fakeSupabase(tables: Record<string, Row[]>) {
  let nextId = 1;
  const resolve = (table: string, row: Row, path: string): unknown => {
    const [head, ...rest] = path.split(".");
    if (rest.length === 0) return row[head];
    const relation = RELATIONS[table]?.[head];
    if (!relation) throw new Error(`Unknown relation ${table}.${head}`);
    const related = (tables[relation.table] ?? []).find((r) => r.id === row[relation.key]);
    return related ? resolve(relation.table, related, rest.join(".")) : undefined;
  };

  function builder(table: string) {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let columns: string[] | null = null;
    let payload: Row[] = [];
    let patch: Row = {};
    let limit: number | null = null;
    let order: { column: string; ascending: boolean } | null = null;
    const filters: Array<(row: Row) => boolean> = [];

    const run = (): Row[] => {
      tables[table] ??= [];
      let rows: Row[];
      if (op === "insert") {
        rows = payload.map((row) => ({ id: `${table}-${nextId++}`, ...row }));
        tables[table].push(...rows);
      } else {
        rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (op === "update") for (const row of rows) Object.assign(row, patch);
        if (op === "delete") tables[table] = tables[table].filter((row) => !rows.includes(row));
      }
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort(
          (a, b) => (Number(a[column] ?? 0) - Number(b[column] ?? 0)) * (ascending ? 1 : -1),
        );
      }
      if (limit != null) rows = rows.slice(0, limit);
      return rows.map((row) =>
        columns ? Object.fromEntries(columns.map((column) => [column, row[column]])) : { ...row },
      );
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
        order = { column, ascending: opts?.ascending ?? true };
        return query;
      },
      limit: (n: number) => {
        limit = n;
        return query;
      },
      single: async () => {
        const rows = run();
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: `expected one ${table} row` } };
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve()
          .then(() => ({ data: run(), error: null }))
          .then(onFulfilled, onRejected),
    };
    return query;
  }

  return { from: (table: string) => builder(table) };
}

const occlusion = {
  imageUrl: "https://project.supabase.co/storage/v1/object/public/card-media/pub/heart.png",
  rects: [
    { id: "a", x: 0.1, y: 0.1, width: 0.2, height: 0.2, ord: 1, enabled: true },
    { id: "b", x: 0.5, y: 0.5, width: 0.2, height: 0.2, ord: 2, enabled: true },
  ],
};

function seedPublisher(): Record<string, Row[]> {
  return {
    projects: [{ id: "deck", user_id: "publisher", name: "Anatomy", deck_name: "Anatomy" }],
    sources: [{ id: "src", project_id: "deck" }],
    generation_jobs: [{ id: "job", source_id: "src" }],
    cards: [
      {
        id: "card-basic",
        job_id: "job",
        type: "basic",
        front: "Q",
        back: "A",
        cloze_text: null,
        extra: null,
        occlusion_data: null,
        tags: [],
        sort_order: 0,
      },
      {
        id: "card-io",
        job_id: "job",
        type: "image-occlusion",
        front: `<img src="${occlusion.imageUrl}">`,
        back: null,
        cloze_text: null,
        extra: "Chambers",
        occlusion_data: occlusion,
        tags: ["heart"],
        sort_order: 1,
      },
    ],
    deck_publications: [],
    publication_cards: [],
    deck_subscriptions: [],
  };
}

const ioCards = (tables: Record<string, Row[]>, jobIds: unknown[]) =>
  tables.cards.filter((card) => jobIds.includes(card.job_id) && card.type === "image-occlusion");

describe("community decks keep image-occlusion data", () => {
  it("publishes, subscribes to and follow-syncs occlusion regions", async () => {
    const tables = seedPublisher();
    const supabase = fakeSupabase(tables) as never;

    const publication = await publishProject(supabase, "publisher", "deck");
    const published = tables.publication_cards.find((card) => card.type === "image-occlusion");
    expect(published?.occlusion_data).toEqual(occlusion);
    expect(tables.publication_cards.find((card) => card.type === "basic")?.occlusion_data).toBeNull();

    const { localProjectId } = await subscribeToPublication(
      supabase,
      "subscriber",
      publication.id,
      "follow",
    );
    const localJobs = tables.generation_jobs
      .filter((job) =>
        tables.sources.some((s) => s.id === job.source_id && s.project_id === localProjectId),
      )
      .map((job) => job.id);
    expect(ioCards(tables, localJobs).map((card) => card.occlusion_data)).toEqual([occlusion]);

    // Publisher adds a region and republishes; the follower picks it up.
    const moved = {
      ...occlusion,
      rects: [...occlusion.rects, { id: "c", x: 0.7, y: 0.1, width: 0.2, height: 0.2, ord: 3 }],
    };
    tables.cards.find((card) => card.id === "card-io")!.occlusion_data = moved;
    await publishProject(supabase, "publisher", "deck");
    expect(await syncFollowSubscriptionIfNeeded(supabase, localProjectId, "subscriber")).toBe(true);
    expect(ioCards(tables, localJobs).map((card) => card.occlusion_data)).toEqual([moved]);
  });
});
