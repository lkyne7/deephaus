import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { requirePlan } from "@/lib/billing/access";
import {
  GoogleDriveAuthError,
  GoogleDriveNotConnectedError,
  getGoogleDriveAccessToken,
  googleDriveConfigured,
} from "@/lib/google-drive/client";

/** Google Picker requires a current user access token in the browser. */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const upgrade = await requirePlan(user!.id, "plus", "Google Drive imports");
  if (upgrade) return upgrade;
  if (!googleDriveConfigured()) {
    return NextResponse.json({ error: "Google Drive is not configured." }, { status: 503 });
  }
  try {
    const accessToken = await getGoogleDriveAccessToken(user!.id);
    return NextResponse.json(
      {
        accessToken,
        apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
        appId: process.env.NEXT_PUBLIC_GOOGLE_APP_ID,
      },
      {
        headers: {
          "Cache-Control": "no-store, private",
          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof GoogleDriveNotConnectedError || error instanceof GoogleDriveAuthError
        ? 401
        : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not authorize Google Picker." },
      { status },
    );
  }
}, "GET /api/google-drive/picker-token");
