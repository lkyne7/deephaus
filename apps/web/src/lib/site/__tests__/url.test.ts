import { expect, it } from "vitest";
import { hostIsIndexable } from "@/lib/site/url";

it("indexes only the real domain", () => {
  expect(hostIsIndexable("www.deephaus.ai")).toBe(true);
  expect(hostIsIndexable("deephaus.ai:443")).toBe(true);
  expect(hostIsIndexable("deephaus-staging.vercel.app")).toBe(false);
  expect(hostIsIndexable("www.deephaus.ai.example.com")).toBe(false);
  expect(hostIsIndexable(null)).toBe(false);
});
