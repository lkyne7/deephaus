import "server-only";

import { createHash, randomInt } from "node:crypto";
import { school_name_primary, verify } from "jbs-swot-email";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import {
  findUniversityByEmailDomain,
  getUniversityById,
  matchedUniversityDomain,
  universityMatchesDomain,
} from "@/lib/user/universities";

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

const APPROVED_ABUSED_DOMAIN_OVERRIDES = new Map([
  ["mail.utoronto.ca", "utoronto.ca"],
]);

const universityIdSchema = z.string().trim().min(1).max(240);

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
    university_id: universityIdSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.username !== undefined ||
      value.full_name !== undefined ||
      value.university_id !== undefined,
    {
      message: "No profile changes provided",
    },
  );

export const universityEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid university email"),
});

export const universityVerificationSendSchema = universityEmailSchema.extend({
  university_id: universityIdSchema.optional(),
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

export async function resolveUniversityEmail(
  email: string,
  selectedUniversityId?: string,
): Promise<{
  email: string;
  universityId: string | null;
  universityName: string;
  universityDomain: string;
}> {
  const normalized = email.trim().toLowerCase();
  const emailDomain = normalized.split("@")[1];
  if (!emailDomain) throw new Error("Enter a valid university email");

  const selectedUniversity = selectedUniversityId
    ? getUniversityById(selectedUniversityId)
    : null;
  if (selectedUniversityId && !selectedUniversity) {
    throw new Error("Select a university from the registry");
  }
  if (selectedUniversity && !universityMatchesDomain(selectedUniversity, emailDomain)) {
    throw new Error("This email domain does not match the selected university");
  }

  const registryUniversity =
    selectedUniversity ?? findUniversityByEmailDomain(emailDomain);
  const overrideDomain = APPROVED_ABUSED_DOMAIN_OVERRIDES.get(emailDomain);
  const overrideUniversity = overrideDomain
    ? findUniversityByEmailDomain(overrideDomain)
    : null;
  const result = await verify(normalized);

  if (result.status === "stoplist") {
    throw new Error("Alumni and forwarding addresses cannot verify a current affiliation");
  }
  if (result.status === "abused" && !overrideUniversity) {
    throw new Error(
      registryUniversity
        ? "This university email domain requires manual review"
        : "This email domain is not in the recognized university registry",
    );
  }
  if (!result.valid && result.status !== "abused" && !registryUniversity) {
    throw new Error("This email domain is not in the recognized university registry");
  }

  const university = selectedUniversity ?? overrideUniversity ?? registryUniversity;
  if (university) {
    const universityDomain = matchedUniversityDomain(university, emailDomain);
    if (!universityDomain) throw new Error("This email domain does not match the university");
    return {
      email: normalized,
      universityId: university.id,
      universityName: university.name,
      universityDomain,
    };
  }

  const universityName = await school_name_primary(normalized);
  if (!universityName) throw new Error("We could not identify this university");
  return {
    email: normalized,
    universityId: null,
    universityName,
    universityDomain: emailDomain,
  };
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
