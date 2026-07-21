import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createUniversityVerificationCode,
  hashUniversityVerificationCode,
  resolveUniversityEmail,
  universityEmailSchema,
} from "@/lib/user/profile";

const CODE_TTL_MINUTES = 15;
const RESEND_COOLDOWN_MS = 60_000;

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const parsed = universityEmailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid email" },
      { status: 400 },
    );
  }

  let university: Awaited<ReturnType<typeof resolveUniversityEmail>>;
  try {
    university = await resolveUniversityEmail(parsed.data.email);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unrecognized university email" },
      { status: 400 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.UNIVERSITY_VERIFICATION_FROM_EMAIL;
  if (!apiKey || !from) {
    return NextResponse.json(
      { error: "University email verification is not configured" },
      { status: 503 },
    );
  }

  const service = createServiceClient();
  const { data: existing, error: existingError } = await service
    .from("university_email_verifications")
    .select("sent_at")
    .eq("user_id", user!.id)
    .maybeSingle();
  if (existingError) {
    console.error("Verification lookup failed:", existingError.message);
    return NextResponse.json({ error: "Failed to send verification code" }, { status: 500 });
  }
  if (
    existing?.sent_at &&
    Date.now() - new Date(existing.sent_at as string).getTime() < RESEND_COOLDOWN_MS
  ) {
    return NextResponse.json(
      { error: "Please wait a minute before requesting another code" },
      { status: 429 },
    );
  }

  const code = createUniversityVerificationCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
  const { error: saveError } = await service.from("university_email_verifications").upsert({
    user_id: user!.id,
    email: university.email,
    university_name: university.universityName,
    university_domain: university.universityDomain,
    code_hash: hashUniversityVerificationCode(user!.id, university.email, code),
    attempts: 0,
    sent_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (saveError) {
    console.error("Verification challenge save failed:", saveError.message);
    return NextResponse.json({ error: "Failed to send verification code" }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const { error: sendError } = await resend.emails.send({
    from,
    to: university.email,
    subject: "Verify your university email for DeepHaus",
    text: `Your DeepHaus verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
  });
  if (sendError) {
    await service.from("university_email_verifications").delete().eq("user_id", user!.id);
    console.error("University verification email failed:", sendError.message);
    return NextResponse.json({ error: "Failed to send verification email" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    university_name: university.universityName,
    email: university.email,
    expires_in_seconds: CODE_TTL_MINUTES * 60,
  });
}
