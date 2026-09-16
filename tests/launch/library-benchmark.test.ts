import { DatabaseSync } from "node:sqlite";
import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import { getLibraryMedia } from "../../packages/local-db/src/queries/media";
it("measures whole-library media discovery for 1k, 10k and 50k cards", async () => {
  const results = [];
  for (const count of [1000, 10000, 50000]) {
    const sqlite = new DatabaseSync(":memory:");
    try {
      for (const table of APP_SCHEMA.tables)
        sqlite.exec(
          `CREATE TABLE "${table.name}"(id TEXT PRIMARY KEY,${table.columns.map((c) => `"${c.name}" ${c.type}`).join(",")})`,
        );
      sqlite.exec(`CREATE INDEX card_job ON cards(job_id);CREATE INDEX review_user_card ON card_reviews(user_id,card_id);
   INSERT INTO projects(id,user_id)VALUES('deck','owner');INSERT INTO sources(id,project_id,user_id)VALUES('source','deck','owner');INSERT INTO generation_jobs(id,source_id)VALUES('job','source');BEGIN;`);
      const insert = sqlite.prepare(
        "INSERT INTO cards(id,job_id,front,back)VALUES(?,?,?,?)",
      );
      for (let n = 0; n < count; n++)
        insert.run(
          String(n),
          "job",
          `Question ${n} ![](https://media.test/${n}.png)`,
          "Answer",
        );
      sqlite.exec("COMMIT");
      const started = performance.now();
      const urls = await getLibraryMedia(
        {
          getAll: async (sql: string, params: any[]) =>
            sqlite.prepare(sql).all(...params),
        } as any,
        "owner",
      );
      const durationMs = performance.now() - started;
      expect(urls.length).toBe(count);
      results.push({
        cards: count,
        media: urls.length,
        discoveryMs: Math.round(durationMs),
      });
    } finally {
      sqlite.close();
    }
  }
  if (process.env.WRITE_BENCHMARK === "1")
    writeFileSync(
      "docs/library-benchmark.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          runtime: process.version,
          scope:
            "In-memory SQLite and media parsing, not device rendering or download throughput",
          results,
        },
        null,
        2,
      ) + "\n",
    );
}, 30_000);
