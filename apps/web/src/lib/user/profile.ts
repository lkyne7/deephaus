import "server-only";

import { createHash, randomInt } from "node:crypto";
import { school_name_primary, verify } from "jbs-swot-email";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "dashboard",
  "deephaus",
  "help",
  "login",
  "moderator",
  "profile",
  "root",
  "settings",
  "signup",
  "support",
  "system",
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-z0-9_]+$/, "Use only lowercase letters, numbers, and underscores")
  .refine((value) => !RESERVED_USERNAMES.has(value), "That username is reserved");

export const profilePatchSchema = z
  .object({
    username: usernameSchema.optional(),
    full_name: z.string().trim().min(1, "Full name is required").max(80).optional(),
  })
  .refine((value) => value.username !== undefined || value.full_name !== undefined, {
    message: "No profile changes provided",
  });

export const universityEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid university email"),
});

export const universityVerifySchema = universityEmailSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code"),
});

export type UserProfile = {
  user_id: string;
  username: string;
  full_name: string;
  university_name: string | null;
  university_domain: string | null;
  university_email: string | null;
  university_email_verified_at: string | null;
};

export async function loadUserProfile(userId: string): Promise<UserProfile | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("user_profiles")
    .select(
      "user_id, username, full_name, university_name, university_domain, university_email, university_email_verified_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data as UserProfile | null;
}

export async function resolveUniversityEmail(email: string): Promise<{
  email: string;
  universityName: string;
  universityDomain: string;
}> {
  const normalized = email.trim().toLowerCase();
  const result = await verify(normalized);
  if (!result.valid) {
    const message =
      result.status === "stoplist"
        ? "Alumni and forwarding addresses cannot verify a current affiliation"
        : "This email domain is not in the recognized university registry";
    throw new Error(message);
  }

  const universityName = await school_name_primary(normalized);
  if (!universityName) throw new Error("We could not identify this university");
  const universityDomain = normalized.split("@")[1];
  if (!universityDomain) throw new Error("Enter a valid university email");

  return { email: normalized, universityName, universityDomain };
}

export function createUniversityVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashUniversityVerificationCode(
  userId: string,
  email: string,
  code: string,
): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("University verification is not configured");
  return createHash("sha256")
    .update(`${secret}:${userId}:${email.toLowerCase()}:${code}`)
    .digest("hex");
}
