import type { SupabaseClient } from "@supabase/supabase-js";

export class CreditsExhaustedError extends Error {
  constructor(message = "Monthly AI credits exhausted.") {
    super(message);
    this.name = "CreditsExhaustedError";
  }
}

function isCreditsExhausted(message: string): boolean {
  return message.includes("AI_CREDITS_EXHAUSTED");
}

export async function reserveWorkerCredits(
  supabase: SupabaseClient,
  input: {
    userId: string;
    idempotencyKey: string;
    action: string;
    credits: number;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const credits = Math.max(1, Math.ceil(input.credits));
  const { data, error } = await supabase
    .from("ai_credit_transactions")
    .insert({
      user_id: input.userId,
      idempotency_key: input.idempotencyKey,
      action: input.action,
      reserved_credits: credits,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (!error && data?.id) return data.id as string;

  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("ai_credit_transactions")
      .select("id,status,action,reserved_credits,resource_type,resource_id")
      .eq("user_id", input.userId)
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    if (!existingError && existing?.id) {
      if (
        existing.action !== input.action ||
        existing.reserved_credits !== credits ||
        existing.resource_type !== input.resourceType ||
        existing.resource_id !== input.resourceId ||
        existing.status === "released"
      ) {
        throw new Error(
          "OCR credit idempotency key does not match the original reservation.",
        );
      }
      return existing.id as string;
    }
  }

  if (error && isCreditsExhausted(error.message)) {
    throw new CreditsExhaustedError();
  }
  throw new Error(error?.message ?? "Could not reserve AI credits.");
}

export async function settleWorkerCredits(
  supabase: SupabaseClient,
  transactionId: string,
  chargedCredits: number,
): Promise<void> {
  const charged = Math.max(0, Math.ceil(chargedCredits));
  const { error } = await supabase
    .from("ai_credit_transactions")
    .update({
      status: charged > 0 ? "settled" : "released",
      charged_credits: charged,
    })
    .eq("id", transactionId)
    .eq("status", "reserved");
  if (error) throw new Error(error.message);
}

export async function releaseWorkerCredits(
  supabase: SupabaseClient,
  transactionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_credit_transactions")
    .update({ status: "released", charged_credits: 0 })
    .eq("id", transactionId)
    .eq("status", "reserved");
  if (error) throw new Error(error.message);
}

export async function releaseWorkerCreditsForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_credit_transactions")
    .update({ status: "released", charged_credits: 0 })
    .eq("resource_type", "source_extraction_job")
    .eq("resource_id", jobId)
    .eq("status", "reserved");
  if (error) throw new Error(error.message);
}
