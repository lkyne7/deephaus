// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { consumeAutoSend, markAutoSend } from "@/lib/create/auto-send";

describe("create auto-send", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("runs a marked prompt exactly once", () => {
    markAutoSend("mitosis");
    expect(consumeAutoSend("mitosis")).toBe(true);
    expect(consumeAutoSend("mitosis")).toBe(false);
  });

  it("ignores a prompt that only arrived through the URL", () => {
    expect(consumeAutoSend("crafted link")).toBe(false);
    markAutoSend("mitosis");
    expect(consumeAutoSend("crafted link")).toBe(false);
  });
});
