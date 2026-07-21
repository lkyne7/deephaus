import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { loadUserProfile, profilePatchSchema } from "@/lib/user/profile";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const profile = await loadUserProfile(user!.id);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json(profile);
  } catch (error) {
    console.error("Profile load failed:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  const parsed = profilePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid profile" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const changes: Record<string, string> = {};
  if (parsed.data.username !== undefined) changes.username = parsed.data.username;
  if (parsed.data.full_name !== undefined) changes.full_name = parsed.data.full_name;

  const { data, error } = await service
    .from("user_profiles")
    .update(changes)
    .eq("user_id", user!.id)
    .select(
      "user_id, username, full_name, university_name, university_domain, university_email, university_email_verified_at",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }
    console.error("Profile update failed:", error.message);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  if (parsed.data.full_name !== undefined) {
    const { error: metadataError } = await supabase.auth.updateUser({
      data: { full_name: parsed.data.full_name, name: parsed.data.full_name },
    });
    if (metadataError) {
      console.error("Profile metadata sync failed:", metadataError.message);
    }
  }

  return NextResponse.json(data);
}
