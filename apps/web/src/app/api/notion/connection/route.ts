import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { deleteNotionConnection } from "@/lib/notion/client";

/** DELETE /api/notion/connection — disconnect Notion for the current user. */
export const DELETE = withApiTiming(async function DELETE() {
  const { user, response } = await requireUser();
  if (response) return response;

  await deleteNotionConnection(user!.id);
  return NextResponse.json({ ok: true });
}, "DELETE /api/notion/connection");
