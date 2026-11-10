import { defineConfig } from "@playwright/test";
export default defineConfig({testDir:"e2e",workers:1,timeout:60000,retries:0,outputDir:"../../../../test-results/qa-adapted",use:{baseURL:process.env.E2E_BASE_URL,trace:"off",screenshot:"only-on-failure"},reporter:"list"});
