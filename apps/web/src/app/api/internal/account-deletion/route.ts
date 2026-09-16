import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processAccountDeletions } from "@/lib/account/deletion";
export const maxDuration = 60;
export async function POST(request: Request) {
  const expected = Buffer.from(process.env.EXTRACTION_WORKER_SECRET ?? "");
  const supplied = Buffer.from(
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  );
  if (
    !expected.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await processAccountDeletions());
  } catch {
    return NextResponse.json({ error: "Cleanup unavailable" }, { status: 503 });
  }
}
