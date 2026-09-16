import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e/web",
  fullyParallel: false,
  // Journeys share fixture accounts; sign-out must not revoke another test's session.
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
