import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import {
  createUniversityVerificationCode,
  hashUniversityVerificationCode,
  resolveUniversityEmail,
  usernameSchema,
} from "@/lib/user/profile";

describe("profile validation", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-secret";
  });

  it("normalizes valid usernames and rejects reserved or unsafe names", () => {
    expect(usernameSchema.parse("  Luke_Kyne ")).toBe("luke_kyne");
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("Admin").success).toBe(false);
    expect(usernameSchema.safeParse("name-with-dash").success).toBe(false);
  });

  it("recognizes a university domain and rejects personal email", async () => {
    await expect(resolveUniversityEmail("student@mit.edu")).resolves.toMatchObject({
      email: "student@mit.edu",
      universityDomain: "mit.edu",
    });
    await expect(resolveUniversityEmail("student@gmail.com")).rejects.toThrow(
      /recognized university registry/,
    );
  });

  it("uses canonical registry names and reviewed subdomain overrides", async () => {
    await expect(resolveUniversityEmail("student@mcmaster.ca")).resolves.toMatchObject({
      universityName: "McMaster University",
      universityDomain: "mcmaster.ca",
    });
    await expect(resolveUniversityEmail("student@mail.utoronto.ca")).resolves.toMatchObject({
      universityName: "University of Toronto",
      universityDomain: "utoronto.ca",
    });
  });

  it("generates six-digit codes and user/email-bound hashes", () => {
    const code = createUniversityVerificationCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(hashUniversityVerificationCode("user-1", "Student@MIT.edu", "123456")).toBe(
      hashUniversityVerificationCode("user-1", "student@mit.edu", "123456"),
    );
    expect(hashUniversityVerificationCode("user-2", "student@mit.edu", "123456")).not.toBe(
      hashUniversityVerificationCode("user-1", "student@mit.edu", "123456"),
    );
  });
});
