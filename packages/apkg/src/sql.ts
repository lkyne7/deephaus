import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import initSqlJs, { type SqlJsStatic } from "sql.js";

/**
 * Shared sql.js loader used by both the .apkg builder and importer.
 *
 * The wasm binary is loaded explicitly via createRequire + readFile because
 * sql.js's default wasm path resolution doesn't work under Next/Turbopack.
 * `@deephaus/apkg` is a server external package, so the literal require below
 * is what Vercel's file tracer needs to ship sql.js with the function.
 */

type EmscriptenModule = Record<string, unknown>;

const localRequire = createRequire(import.meta.url);

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function loadWasmBinary(): Promise<ArrayBuffer | undefined> {
  try {
    const wasmPath = localRequire.resolve("sql.js/dist/sql-wasm.wasm");
    const buf = await readFile(wasmPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return undefined;
  }
}

export async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const wasmBinary = await loadWasmBinary();
      return initSqlJs(
        wasmBinary ? ({ wasmBinary } as unknown as Partial<EmscriptenModule>) : {},
      );
    })();
  }
  return sqlPromise;
}
