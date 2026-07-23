import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const AI_CREDITS_EXHAUSTED = "AI_CREDITS_EXHAUSTED";

export function creditIdempotencyKey(
  userId: string,
  operation: string,
  suppliedKey?: string | null,
): string {
  const requestKey = suppliedKey?.trim() || randomUUID();
  const digest = createHash("sha256")
    .update(`${userId}\0${operation}\0${requestKey}`, "utf8")
    .digest("hex");
  return `${operation}:${digest}`;
}

export type AiCreditTransactionStatus = "reserved" | "settled" | "released";

export type AiCreditTransaction = {
  id: string;
  user_id: string;
  period_id: string | null;
  idempotency_key: string;
  action: string;
  status: AiCreditTransactionStatus;
  reserved_credits: number;
  charged_credits: number;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export class AiCreditsExhaustedError extends Error {
  readonly code = AI_CREDITS_EXHAUSTED;

  constructor(
    readonly allowance: number,
    readonly consumed: number,
    readonly required: number,
  ) {
    super("AI credits exhausted.");
    this.name = "AiCreditsExhaustedError";
  }
}

export class AiCreditIdempotencyError extends Error {
  constructor(message = "AI credit idempotency key was reused for a different operation.") {
    super(message);
    this.name = "AiCreditIdempotencyError";
  }
}

type DatabaseError = {
  code?: string | null;
  message?: string | null;
};

const EXHAUSTED_PATTERN = /AI_CREDITS_EXHAUSTED:(\d+):(\d+):(\d+)/;

export function parseAiCreditError(error: unknown): Error {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);
  const match = message.match(EXHAUSTED_PATTERN);
  if (match) {
    return new AiCreditsExhaustedError(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export function isAiCreditsExhaustedError(
  error: unknown,
): error is AiCreditsExhaustedError {
  return error instanceof AiCreditsExhaustedError;
}

export function aiCreditsExhaustedResponse(error: AiCreditsExhaustedError) {
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
      allowance: error.allowance,
      consumed: error.consumed,
      required: error.required,
      remaining: Math.max(0, error.allowance - error.consumed),
    },
    { status: 402 },
  );
}

type ReserveAiCreditsInput = {
  userId: string;
  idempotencyKey: string;
  action: string;
  reservedCredits: number;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

type ReconcileAiCreditsInput = {
  userId: string;
  idempotencyKey: string;
};

type SettleAiCreditsInput = ReconcileAiCreditsInput & {
  chargedCredits: number;
};

function serviceClient(): SupabaseClient {
  return createServiceClient();
}

async function loadTransaction(
  client: SupabaseClient,
  userId: string,
  idempotencyKey: string,
): Promise<AiCreditTransaction | null> {
  const { data, error } = await client
    .from("ai_credit_transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw parseAiCreditError(error);
  return (data as AiCreditTransaction | null) ?? null;
}

function assertMatchingReservation(
  transaction: AiCreditTransaction,
  input: ReserveAiCreditsInput,
) {
  if (
    transaction.action !== input.action ||
    transaction.reserved_credits !== input.reservedCredits ||
    transaction.resource_type !== (input.resourceType ?? null) ||
    transaction.resource_id !== (input.resourceId ?? null)
  ) {
    throw new AiCreditIdempotencyError();
  }
}

export async function reserveAiCredits(
  input: ReserveAiCreditsInput,
): Promise<AiCreditTransaction> {
  if (!Number.isInteger(input.reservedCredits) || input.reservedCredits <= 0) {
    throw new RangeError("reservedCredits must be a positive integer.");
  }

  const client = serviceClient();
  const existing = await loadTransaction(client, input.userId, input.idempotencyKey);
  if (existing) {
    assertMatchingReservation(existing, input);
    return existing;
  }

  const { data, error } = await client
    .from("ai_credit_transactions")
    .insert({
      user_id: input.userId,
      idempotency_key: input.idempotencyKey,
      action: input.action,
      status: "reserved",
      reserved_credits: input.reservedCredits,
      charged_credits: 0,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (!error && data) return data as AiCreditTransaction;

  const databaseError = error as DatabaseError | null;
  if (databaseError?.code === "23505") {
    const concurrent = await loadTransaction(client, input.userId, input.idempotencyKey);
    if (concurrent) {
      assertMatchingReservation(concurrent, input);
      return concurrent;
    }
  }

  throw parseAiCreditError(error ?? new Error("Failed to reserve AI credits."));
}

async function reconcileAiCredits(
  input: ReconcileAiCreditsInput,
  status: "settled" | "released",
  requestedCharge: number,
): Promise<AiCreditTransaction> {
  const client = serviceClient();
  const existing = await loadTransaction(client, input.userId, input.idempotencyKey);
  if (!existing) {
    throw new Error("AI credit transaction not found.");
  }

  // A reservation is a hold: the database rejects settling above it
  // (AI_CREDIT_CHARGE_EXCEEDS_RESERVATION). Actual usage can exceed the
  // estimate that was reserved (e.g. generation yields more cards than the
  // word-count estimate), so cap the charge at the quoted hold instead of
  // failing and forcing callers to roll back completed work.
  const chargedCredits =
    status === "settled"
      ? Math.min(requestedCharge, existing.reserved_credits)
      : requestedCharge;

  // A terminal transaction is immutable. Cleanup release calls are safe no-ops,
  // while settle retries must match the charge that won the race.
  if (existing.status !== "reserved") {
    if (status === "released") return existing;
    if (
      existing.status === "settled" &&
      existing.charged_credits === chargedCredits
    ) {
      return existing;
    }
    throw new AiCreditIdempotencyError(
      existing.status === "released"
        ? "AI credit transaction was already released."
        : "AI credit transaction was already settled with a different charge.",
    );
  }

  const { data, error } = await client
    .from("ai_credit_transactions")
    .update({
      status,
      charged_credits: status === "settled" ? chargedCredits : 0,
    })
    .eq("id", existing.id)
    .eq("user_id", input.userId)
    .eq("status", "reserved")
    .select("*")
    .maybeSingle();

  if (error) throw parseAiCreditError(error);
  if (data) return data as AiCreditTransaction;

  const concurrent = await loadTransaction(client, input.userId, input.idempotencyKey);
  if (concurrent) {
    if (status === "released") return concurrent;
    if (
      concurrent.status === "settled" &&
      concurrent.charged_credits === chargedCredits
    ) {
      return concurrent;
    }
    throw new AiCreditIdempotencyError(
      "AI credit transaction was finalized concurrently.",
    );
  }
  throw new Error("AI credit transaction disappeared during reconciliation.");
}

export async function settleAiCredits(
  input: SettleAiCreditsInput,
): Promise<AiCreditTransaction> {
  if (!Number.isInteger(input.chargedCredits) || input.chargedCredits < 0) {
    throw new RangeError("chargedCredits must be a non-negative integer.");
  }
  return reconcileAiCredits(input, "settled", input.chargedCredits);
}

export async function releaseAiCredits(
  input: ReconcileAiCreditsInput,
): Promise<AiCreditTransaction> {
  return reconcileAiCredits(input, "released", 0);
}
