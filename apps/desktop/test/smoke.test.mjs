// Launches the built shell against a throwaway local origin and checks the
// bridge, the user agent, external-link handling and the offline first run.
// Requires `pnpm build` first (the package test script does this).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageHtml = `<!doctype html><title>Fake DeepHaus</title><main id="app">ok</main>
<a id="external" href="https://example.com/outside" target="_blank">out</a>`;

let server;
let origin;
const userDataDirs = [];

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(pageHtml);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const dir of userDataDirs) rmSync(dir, { recursive: true, force: true });
});

async function launch(extraEnv = {}) {
  const userData = mkdtempSync(path.join(tmpdir(), "deephaus-desktop-"));
  userDataDirs.push(userData);
  // Some hosts (VS Code, agent harnesses) export ELECTRON_RUN_AS_NODE, which
  // would turn the binary into plain Node and skip the Electron runtime.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...baseEnv } = process.env;
  const app = await electron.launch({
    args: [root],
    env: {
      ...baseEnv,
      APP_VARIANT: "development",
      DEEPHAUS_DESKTOP_ORIGIN: origin,
      DEEPHAUS_DESKTOP_USER_DATA: userData,
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  return { app, page, userData };
}

test("exposes the desktop bridge on app pages with a tagged user agent", async () => {
  const { app, page } = await launch();
  try {
    await page.waitForSelector("#app");
    const bridge = await page.evaluate(() => {
      const b = window.deephausDesktop;
      return b && { version: b.version, variant: b.variant, platform: b.platform, hasNavigate: typeof b.onNavigate };
    });
    assert.equal(bridge.variant, "development");
    assert.equal(bridge.platform, process.platform);
    assert.equal(bridge.hasNavigate, "function");
    assert.match(await page.evaluate(() => navigator.userAgent), /DeepHausDesktop\/\d+\.\d+\.\d+/);
    assert.equal(await page.evaluate(() => window.deephausDesktopShell), undefined);
  } finally {
    await app.close();
  }
});

test("menu navigation reaches the page through the bridge", async () => {
  const { app, page } = await launch();
  try {
    await page.waitForSelector("#app");
    await page.evaluate(() => {
      window.__paths = [];
      window.deephausDesktop.onNavigate((p) => window.__paths.push(p));
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send("deephaus:navigate", "/decks/abc");
    });
    await page.waitForFunction(() => window.__paths.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__paths), ["/decks/abc"]);
  } finally {
    await app.close();
  }
});

test("shows the bundled offline page when a fresh install cannot reach the app", async () => {
  // A closed port behaves like no network for a first run.
  const dead = createServer();
  await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
  const deadOrigin = `http://127.0.0.1:${dead.address().port}`;
  await new Promise((resolve) => dead.close(resolve));

  const { app, page } = await launch({ DEEPHAUS_DESKTOP_ORIGIN: deadOrigin });
  try {
    await page.waitForSelector("#retry");
    assert.match(await page.url(), /offline\.html$/);
    assert.equal(await page.evaluate(() => typeof window.deephausDesktopShell?.retry), "function");
    assert.equal(await page.evaluate(() => window.deephausDesktop), undefined);
  } finally {
    await app.close();
  }
});
