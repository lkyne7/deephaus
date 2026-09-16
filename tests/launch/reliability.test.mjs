import test from "node:test";
import assert from "node:assert/strict";
import {
  OfflineMediaLibrary,
  removeStorageTree,
  serializeSave,
  fetchWithDeadline,
  requiredCardMedia,
} from "../../packages/shared/dist/index.js";

test("storage cleanup exhausts folders larger than 1,000 entries and propagates removal errors", async () => {
  const files = new Set(
    Array.from({ length: 2301 }, (_, n) => `user/folder/${n}`),
  );
  let removals = 0;
  const bucket = {
    async list(prefix) {
      if (prefix === "user")
        return {
          data: files.size ? [{ name: "folder", id: null }] : [],
          error: null,
        };
      return {
        data: [...files]
          .slice(0, 1000)
          .map((path) => ({ id: path, name: path.split("/").at(-1) })),
        error: null,
      };
    },
    async remove(paths) {
      removals++;
      for (const path of paths) files.delete(path);
      return { error: null };
    },
  };
  await removeStorageTree(bucket, "user");
  assert.equal(files.size, 0);
  assert.equal(removals, 24);
  await assert.rejects(
    removeStorageTree(
      {
        async list() {
          return { data: [{ id: "1", name: "file" }], error: null };
        },
        async remove() {
          return { error: { message: "storage unavailable" } };
        },
      },
      "user",
    ),
    /storage unavailable/,
  );
});
test("saves for the same card stay ordered across failures and different cards proceed", async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const first = serializeSave("a", async () => {
    order.push("a1");
    await gate;
    throw new Error("offline");
  });
  const second = serializeSave("a", async () => order.push("a2"));
  await serializeSave("b", async () => order.push("b"));
  assert.deepEqual(order, ["a1", "b"]);
  release();
  await assert.rejects(first);
  await second;
  assert.deepEqual(order, ["a1", "b", "a2"]);
});
function storage() {
  let manifest = [];
  const files = new Map();
  let fail = false;
  return {
    files,
    setFail(v) {
      fail = v;
    },
    async load() {
      return structuredClone(manifest);
    },
    async save(rows) {
      manifest = structuredClone(rows);
    },
    async exists(e) {
      return files.has(e.url);
    },
    async remove(e) {
      files.delete(e.url);
    },
    async download(url, signal) {
      if (fail || signal.aborted) throw new Error("full");
      files.set(url, true);
      return { localUri: `file:${url}`, bytes: 10 };
    },
  };
}
test("download readiness survives restart, detects eviction, and never calls incomplete media ready", async () => {
  const adapter = storage();
  let state;
  let library = new OfflineMediaLibrary(adapter, (s) => (state = s));
  await library.initialize();
  await library.reconcile(["https://media/one", "https://media/two"], false);
  await library.run();
  assert.equal(state.state, "Downloading");
  await library.reconcile(["https://media/one", "https://media/two"], true);
  assert.equal(state.state, "Ready offline");
  assert.equal(state.bytes, 20);
  library.stop();
  library = new OfflineMediaLibrary(adapter, (s) => (state = s));
  await library.initialize();
  await library.reconcile(["https://media/one", "https://media/two"], true);
  assert.equal(state.state, "Ready offline");
  adapter.files.delete("https://media/one");
  await library.verify();
  assert.equal(state.state, "Downloading");
  adapter.setFail(true);
  await library.run();
  assert.equal(state.state, "Needs attention");
  adapter.setFail(false);
  await library.run(true);
  assert.equal(state.state, "Ready offline");
});
test("paused downloads remain pending; separate account stores never inherit manifests", async () => {
  const a = storage(),
    b = storage();
  let state;
  const first = new OfflineMediaLibrary(a, () => {});
  await first.initialize();
  await first.reconcile(["https://media/a"], true);
  await first.run();
  const second = new OfflineMediaLibrary(b, (s) => (state = s));
  await second.initialize();
  second.setPaused(true);
  await second.reconcile(["https://media/b"], true);
  await second.run();
  assert.equal(state.state, "Paused");
  assert.equal(state.downloaded, 0);
});
test("extracts all supported field images and occlusion backgrounds once", () => {
  assert.deepEqual(
    requiredCardMedia({
      front: "![image](https://media/a)",
      extra: "![again](https://media/a)",
      occlusion_data: JSON.stringify({ imageUrl: "https://media/b" }),
    }),
    ["https://media/a", "https://media/b"],
  );
});
test("request deadline aborts a stalled body and never retries a mutation", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, { signal }) => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener(
            "abort",
            () => controller.error(signal.reason),
            { once: true },
          );
        },
      }),
    );
  };
  try {
    await assert.rejects(
      fetchWithDeadline("https://example.test", { method: "POST" }, 15),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('retry reopens media storage after an initial transient failure', async () => {
  let attempts = 0, state, saved = [];
  const library = new OfflineMediaLibrary({
    async load() { if (++attempts === 1) throw new Error('storage busy'); return saved; },
    async save(entries) { saved = structuredClone(entries); },
    async exists() { return true; },
    async remove() {},
    async download(url) { return {localUri: url, bytes: 10}; },
  }, next => { state = next; });
  await library.initialize();
  assert.equal(state.state, 'Needs attention');
  await library.reconcile(['https://fixture.test/card.png'], true);
  await library.run(true);
  assert.equal(attempts, 2);
  assert.equal(state.state, 'Ready offline');
  assert.equal(state.downloaded, 1);
});
