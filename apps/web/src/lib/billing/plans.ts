export const PLAN_KEYS = ["basic", "plus", "pro"] as const;

export type PlanKey = (typeof PLAN_KEYS)[number];

export type BillingFeatureGates = {
  manualStudy: boolean;
  fsrsScheduling: boolean;
  aiGeneration: boolean;
  cloudSources: boolean;
  automaticOcclusion: boolean;
  advancedAnalytics: boolean;
  videoTranscription: boolean;
  mcpAccess: boolean;
  priorityProcessing: boolean;
};

export type BillingPlan = {
  key: PlanKey;
  name: string;
  monthlyCredits: number;
  priority: 0 | 1;
  features: BillingFeatureGates;
};

const CORE_FEATURES = {
  manualStudy: true,
  fsrsScheduling: true,
  aiGeneration: true,
} as const;

export const BILLING_PLANS = {
  basic: {
    key: "basic",
    name: "Basic",
    monthlyCredits: 250,
    priority: 0,
    features: {
      ...CORE_FEATURES,
      cloudSources: false,
      automaticOcclusion: false,
      advancedAnalytics: false,
      videoTranscription: true,
      mcpAccess: false,
      priorityProcessing: false,
    },
  },
  plus: {
    key: "plus",
    name: "Plus",
    monthlyCredits: 3000,
    priority: 0,
    features: {
      ...CORE_FEATURES,
      cloudSources: true,
      automaticOcclusion: true,
      advancedAnalytics: true,
      videoTranscription: true,
      mcpAccess: false,
      priorityProcessing: false,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyCredits: 8000,
    priority: 1,
    features: {
      ...CORE_FEATURES,
      cloudSources: true,
      automaticOcclusion: true,
      advancedAnalytics: true,
      videoTranscription: true,
      mcpAccess: true,
      priorityProcessing: true,
    },
  },
} as const satisfies Record<PlanKey, BillingPlan>;

export type BillingFeature = keyof BillingFeatureGates;

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLAN_KEYS.includes(value as PlanKey);
}

export function normalizePlanKey(value: unknown): PlanKey {
  return isPlanKey(value) ? value : "basic";
}

export function getBillingPlan(value: unknown): BillingPlan {
  return BILLING_PLANS[normalizePlanKey(value)];
}

export function getPlanCreditAllowance(value: unknown): number {
  return getBillingPlan(value).monthlyCredits;
}

export function getPlanPriority(value: unknown): 0 | 1 {
  return getBillingPlan(value).priority;
}

export function hasPlanFeature(value: unknown, feature: BillingFeature): boolean {
  return getBillingPlan(value).features[feature];
}
