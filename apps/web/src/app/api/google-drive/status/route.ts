import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  getGoogleDriveConnection,
  googleDriveConfigured,
} from "@/lib/google-drive/client";

/** Connection state only; OAuth credentials never leave the server. */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!googleDriveConfigured()) {
    return NextResponse.json({ configured: false, connected: false });
  }
  const connection = await getGoogleDriveConnection(user!.id);
  return NextResponse.json({
    configured: true,
    connected: Boolean(connection),
    accountEmail: connection?.account_email ?? null,
    accountName: connection?.account_name ?? null,
  });
}, "GET /api/google-drive/status");
