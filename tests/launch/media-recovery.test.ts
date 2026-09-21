import { expect, it, vi } from "vitest";
import { OfflineMediaLibrary, type MediaEntry } from "../../packages/shared/src/offline-media";

it("preserves the persisted download manifest while storage cannot be read", async () => {
  const url = "https://fixture.test/retained.png";
  let manifest: MediaEntry[] = [{ url, localUri: "file:retained", bytes: 42, attempts: 1 }];
  let unavailable = true;
  const save = vi.fn(async (entries: MediaEntry[]) => { manifest = structuredClone(entries); });
  const download = vi.fn(async () => { throw new Error("offline"); });
  const library = new OfflineMediaLibrary({
    load: async () => {
      if (unavailable) throw new Error("storage temporarily locked");
      return structuredClone(manifest);
    },
    save, exists: async () => true, remove: async () => {}, download,
  }, () => {});
  await library.initialize();
  await library.reconcile([url], true);
  await library.run();
  expect(save).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  unavailable = false;
  await library.reconcile([url], true);
  await library.run(true);
  expect(manifest[0].localUri).toBe("file:retained");
  expect(download).not.toHaveBeenCalled();
});
