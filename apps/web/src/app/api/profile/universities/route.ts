import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { resolveUniversityEmail, universityEmailSchema } from "@/lib/user/profile";
import { searchUniversities } from "@/lib/user/universities";

export async function GET(request: Request) {
  const { response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (email) {
    const parsed = universityEmailSchema.safeParse({ email });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid email" },
        { status: 400 },
      );
    }

    try {
      const university = await resolveUniversityEmail(parsed.data.email);
      return NextResponse.json({
        university: {
          id: university.universityId,
          name: university.universityName,
          domain: university.universityDomain,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "University not recognized" },
        { status: 404 },
      );
    }
  }

  const query = searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number(searchParams.get("limit") ?? "12");
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 12;

  return NextResponse.json({
    universities: searchUniversities(query, limit),
  });
}
