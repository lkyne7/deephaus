import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  hashUniversityVerificationCode,
  loadUserProfile,
  universityVerifySchema,
} from "@/lib/user/profile";

const STATUS_ERRORS: Record<string, { error: string; status: number }> = {
  missing: { error: "Request a new verification code", status: 404 },
  email_mismatch: { error: "This code was sent to a different email", status: 400 },
  expired: { error: "This code has expired. Request a new one", status: 410 },
  locked: { error: "Too many incorrect attempts. Request a new code", status: 429 },
  invalid: { error: "Incorrect verification code", status: 400 },
};

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const parsed = universityVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid verification code" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: result, error } = await service.rpc("complete_university_email_verification", {
    target_user_id: user!.id,
    target_email: parsed.data.email,
    submitted_code_hash: hashUniversityVerificationCode(
      user!.id,
      parsed.data.email,
      parsed.data.code,
    ),
  });

  if (error) {
    console.error("University verification failed:", error.message);
    return NextResponse.json({ error: "Failed to verify university email" }, { status: 500 });
  }

  if (result !== "verified") {
    const detail = STATUS_ERRORS[String(result)] ?? {
      error: "Failed to verify university email",
      status: 400,
    };
    return NextResponse.json({ error: detail.error }, { status: detail.status });
  }

  const profile = await loadUserProfile(user!.id);
  return NextResponse.json({ ok: true, profile });
}
