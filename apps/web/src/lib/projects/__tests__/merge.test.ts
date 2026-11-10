import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MergeProjectsError, mergeProjects } from "@/lib/projects/merge";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; filters: Array<[string, string, unknown]>; values?: Row };

/** A tiny in-memory stand-in for the handful of PostgREST calls a merge makes. */
function fakeSupabase(tables: Record<string, Row[]>, failOn?: { table: string; op: string }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    let head = false;
    const matches = (row: Row) =>
      call.filters.every(([kind, column, value]) =>
        kind === "eq" ? row[column] === value : (value as unknown[]).includes(row[column]),
      );
    const run = () => {
      calls.push(call);
      if (failOn && failOn.table === table && failOn.op === call.op) {
        return { data: null, count: null, error: { message: `${table} ${call.op} failed` } };
      }
      const rows = (tables[table] ?? []).filter(matches);
      if (call.op === "update") for (const row of rows) Object.assign(row, call.values);
      if (call.op === "delete") tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
      return { data: head ? null : rows, count: rows.length, error: null };
    };
    const chain: Record<string, unknown> = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        head = Boolean(options?.head);
        return chain;
      },
      update: (values: Row) => {
        call.op = "update";
        call.values = values;
        return chain;
      },
      delete: () => {
        call.op = "delete";
        return chain;
      },
      eq: (column: string, value: unknown) => (call.filters.push(["eq", column, value]), chain),
      in: (column: string, value: unknown[]) => (call.filters.push(["in", column, value]), chain),
      limit: () => chain,
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return chain;
  };
  return { client: { from } as never, calls, tables };
}

const USER = "user-1";

function library() {
  return {
    projects: [
      { id: "keep", user_id: USER, name: "Biology" },
      { id: "b", user_id: USER, name: "Mitosis" },
      { id: "c", user_id: USER, name: "Meiosis" },
      { id: "other", user_id: "someone-else", name: "Not yours" },
    ],
    sources: [
      { id: "s1", user_id: USER, project_id: "keep" },
      { id: "s2", user_id: USER, project_id: "b" },
      { id: "s3", user_id: USER, project_id: "c" },
    ],
    deck_publications: [] as Row[],
    deck_subscriptions: [] as Row[],
    cram_plan_items: [{ id: "i1", project_id: "b" }],
    cram_plans: [{ id: "p1", user_id: USER, selection_spec: { deck_ids: ["b", "keep", "c"], tags: ["x"] } }],
  };
}

describe("mergeProjects", () => {
  it("moves the sources, repoints cram plans, removes the emptied decks and renames", async () => {
    const { client, tables, calls } = fakeSupabase(library());

    const result = await mergeProjects(client, USER, { keepId: "keep", otherIds: ["b", "c", "b"], name: " Cell biology " });

    expect(result).toEqual({ projectId: "keep", mergedCount: 2 });
    expect(tables.sources.map((row) => row.project_id)).toEqual(["keep", "keep", "keep"]);
    expect(tables.projects.map((row) => row.id).sort()).toEqual(["keep", "other"]);
    expect(tables.projects.find((row) => row.id === "keep")).toMatchObject({
      name: "Cell biology",
      deck_name: "Cell biology",
    });
    expect(tables.cram_plan_items[0].project_id).toBe("keep");
    expect(tables.cram_plans[0].selection_spec).toEqual({ deck_ids: ["keep"], tags: ["x"] });

    // Nothing is deleted until the sources have moved.
    const moved = calls.findIndex((call) => call.table === "sources" && call.op === "update");
    const removed = calls.findIndex((call) => call.table === "projects" && call.op === "delete");
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(moved);
  });

  it("needs a second deck and decks the user owns", async () => {
    const { client, tables } = fakeSupabase(library());
    await expect(mergeProjects(client, USER, { keepId: "keep", otherIds: ["keep"] })).rejects.toMatchObject({
      status: 400,
    });
    await expect(mergeProjects(client, USER, { keepId: "keep", otherIds: ["other"] })).rejects.toMatchObject({
      status: 404,
    });
    expect(tables.sources.map((row) => row.project_id)).toEqual(["keep", "b", "c"]);
  });

  it("refuses published decks and decks from Community", async () => {
    const published = library();
    published.deck_publications.push({ id: "pub", source_project_id: "b" });
    await expect(
      mergeProjects(fakeSupabase(published).client, USER, { keepId: "keep", otherIds: ["b"] }),
    ).rejects.toMatchObject({ status: 409 });

    const added = library();
    added.deck_subscriptions.push({ id: "sub", local_project_id: "keep" });
    const fake = fakeSupabase(added);
    await expect(mergeProjects(fake.client, USER, { keepId: "keep", otherIds: ["b"] })).rejects.toBeInstanceOf(
      MergeProjectsError,
    );
    expect(fake.tables.projects).toHaveLength(4);
  });

  it("deletes nothing when the sources could not be moved", async () => {
    const { client, tables } = fakeSupabase(library(), { table: "sources", op: "update" });
    await expect(mergeProjects(client, USER, { keepId: "keep", otherIds: ["b", "c"] })).rejects.toMatchObject({
      status: 500,
    });
    expect(tables.projects).toHaveLength(4);
  });
});
