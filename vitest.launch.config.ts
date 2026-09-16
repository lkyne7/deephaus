import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "@": new URL("./apps/mobile", import.meta.url).pathname },
  },
  test: {
    include: ["tests/launch/**/*.test.ts", "apps/mobile/test/**/*.test.ts"],
  },
});
