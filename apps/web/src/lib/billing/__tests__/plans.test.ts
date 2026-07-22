import { describe, expect, it } from "vitest";
import {
  getBillingPlan,
  getPlanCreditAllowance,
  getPlanPriority,
  hasPlanFeature,
  isPlanKey,
  normalizePlanKey,
} from "@/lib/billing/plans";

describe("billing plans", () => {
  it("defines the monthly allowances and queue priorities", () => {
    expect(getPlanCreditAllowance("basic")).toBe(250);
    expect(getPlanCreditAllowance("plus")).toBe(3000);
    expect(getPlanCreditAllowance("pro")).toBe(8000);
    expect(["basic", "plus", "pro"].map(getPlanPriority)).toEqual([0, 0, 1]);
    expect(hasPlanFeature("plus", "priorityProcessing")).toBe(false);
    expect(hasPlanFeature("pro", "priorityProcessing")).toBe(true);
  });

  it("falls back safely for untrusted plan values", () => {
    expect(isPlanKey("enterprise")).toBe(false);
    expect(normalizePlanKey("enterprise")).toBe("basic");
    expect(getBillingPlan(null).key).toBe("basic");
    expect(hasPlanFeature({}, "priorityProcessing")).toBe(false);
  });

  it("keeps core study features free and gates paid capabilities", () => {
    expect(hasPlanFeature("basic", "manualStudy")).toBe(true);
    expect(hasPlanFeature("basic", "fsrsScheduling")).toBe(true);
    expect(hasPlanFeature("basic", "mcpAccess")).toBe(false);
    expect(hasPlanFeature("pro", "mcpAccess")).toBe(true);
  });
});
