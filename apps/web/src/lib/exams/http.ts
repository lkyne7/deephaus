import { NextResponse } from "next/server";
import { z } from "zod";
import { ExamServiceError } from "@/lib/exams/errors";

export function examErrorResponse(error: unknown) {
  if (error instanceof ExamServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: error.errors[0]?.message ?? "Invalid request",
        issues: error.flatten(),
      },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Unexpected exam error";
  console.error("[exams]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ExamServiceError("Invalid JSON body", 400);
  }
}
