import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import {
  SourceDocumentConflictError,
  saveLocalSourceDocument,
} from "../../packages/local-db/src/queries/source-document";

// Offline-first saves go to the local replica, which is shared by every tab,
// so a stale tab must not overwrite newer edits there either.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const table of APP_SCHEMA.tables)
    sqlite.exec(
      `CREATE TABLE "${table.name}" (id TEXT PRIMARY KEY,${table.columns.map((c) => `"${c.name}" ${c.type}`).join(",")})`,
    );
  const db: any = {
    async execute(sql: string, params: any[] = []) {
      const result = sqlite.prepare(sql).run(...params);
      return { rowsAffected: Number(result.changes) };
    },
    async getOptional(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    async writeTransaction(fn: (tx: any) => Promise<unknown>) {
      sqlite.exec("BEGIN");
      try {
        const result = await fn(db);
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite };
}

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function seed(sqlite: DatabaseSync, contentEditedAt: string | null) {
  sqlite
    .prepare(
      `INSERT INTO sources (id, type, raw_text, edited_content, content_edited_at) VALUES ('src', 'text', ?, ?, ?)`,
    )
    .run("Newer edit", JSON.stringify(doc("Newer edit")), contentEditedAt);
}

function rawText(sqlite: DatabaseSync) {
  return (sqlite.prepare(`SELECT raw_text FROM sources WHERE id = 'src'`).get() as { raw_text: string })
    .raw_text;
}

describe("local source document saves", () => {
  it("rejects a save based on a stale version", async () => {
    const { db, sqlite } = database();
    try {
      // PowerSync replicates timestamptz in its own text format.
      seed(sqlite, "2026-10-19 12:00:05.000Z");
      await expect(
        saveLocalSourceDocument(db, {
          sourceId: "src",
          content: doc("Stale tab"),
          rawText: "Stale tab",
          expectedEditedAt: "2026-10-19T12:00:00.000Z",
        }),
      ).rejects.toBeInstanceOf(SourceDocumentConflictError);
      expect(rawText(sqlite)).toBe("Newer edit");
    } finally {
      sqlite.close();
    }
  });

  it("saves the loaded version, whatever its timestamp format, and returns the next one", async () => {
    const { db, sqlite } = database();
    try {
      seed(sqlite, "2026-10-19 12:00:05.000Z");
      const first = await saveLocalSourceDocument(db, {
        sourceId: "src",
        content: doc("Edit one"),
        rawText: "Edit one",
        expectedEditedAt: "2026-10-19T12:00:05.000+00:00",
      });
      expect(rawText(sqlite)).toBe("Edit one");
      await saveLocalSourceDocument(db, {
        sourceId: "src",
        content: doc("Edit two"),
        rawText: "Edit two",
        expectedEditedAt: first.contentEditedAt,
      });
      expect(rawText(sqlite)).toBe("Edit two");
    } finally {
      sqlite.close();
    }
  });

  it("treats null as the version of a never-edited document", async () => {
    const { db, sqlite } = database();
    try {
      seed(sqlite, null);
      await saveLocalSourceDocument(db, {
        sourceId: "src",
        content: doc("First"),
        rawText: "First",
        expectedEditedAt: null,
      });
      await expect(
        saveLocalSourceDocument(db, {
          sourceId: "src",
          content: doc("Stale"),
          rawText: "Stale",
          expectedEditedAt: null,
        }),
      ).rejects.toBeInstanceOf(SourceDocumentConflictError);
      expect(rawText(sqlite)).toBe("First");
    } finally {
      sqlite.close();
    }
  });
});
