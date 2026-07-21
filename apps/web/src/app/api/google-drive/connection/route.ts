import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { deleteGoogleDriveConnection } from "@/lib/google-drive/client";

/** Disconnect Drive; already imported sources remain untouched. */
export const DELETE = withApiTiming(async function DELETE() {
  const { user, response } = await requireUser();
  if (response) return response;
  await deleteGoogleDriveConnection(user!.id);
  return NextResponse.json({ ok: true });
}, "DELETE /api/google-drive/connection");
