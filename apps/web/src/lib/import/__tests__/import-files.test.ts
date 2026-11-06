import { MAX_APKG_BYTES } from "@deephaus/shared";
import { describe, expect, it } from "vitest";
import { ankiPackageError, onlyFile } from "@/lib/import/import-files";

describe("ankiPackageError", () => {
  it("accepts Anki packages in any case", () => {
    expect(ankiPackageError({ name: "biology.apkg", size: 10 })).toBeNull();
    expect(ankiPackageError({ name: "Collection.COLPKG", size: 10 })).toBeNull();
  });

  it("rejects other file types", () => {
    expect(ankiPackageError({ name: "notes.pdf", size: 10 })).toMatch(/\.apkg or \.colpkg/);
    expect(ankiPackageError({ name: "apkg", size: 10 })).toMatch(/\.apkg or \.colpkg/);
  });

  it("rejects packages over the size limit", () => {
    expect(ankiPackageError({ name: "big.apkg", size: MAX_APKG_BYTES })).toBeNull();
    expect(ankiPackageError({ name: "big.apkg", size: MAX_APKG_BYTES + 1 })).toMatch(/under/);
  });
});

describe("onlyFile", () => {
  it("returns a single file", () => {
    expect(onlyFile(["a"])).toEqual({ file: "a" });
  });

  it("refuses several files, or none", () => {
    expect(onlyFile(["a", "b"])).toEqual({ error: "Drop one file at a time." });
    expect(onlyFile([])).toEqual({ error: "Drop one file at a time." });
  });
});
