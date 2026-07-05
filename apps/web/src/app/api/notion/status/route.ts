import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { getNotionConnection, notionConfigured, notionRedirectUri } from "@/lib/notion/client";
import { requestOrigin } from "@/lib/notion/request-origin";

/** GET /api/notion/status — connection state for chips and pickers. */
export const GET = withApiTiming(async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const configured = notionConfigured();
  if (!configured) {
    return NextResponse.json({ configured: false, connected: false });
  }

  const connection = await getNotionConnection(user!.id);
  return NextResponse.json({
    configured: true,
    connected: Boolean(connection),
    workspaceName: connection?.workspace_name ?? null,
    workspaceIcon: connection?.workspace_icon ?? null,
    redirectUri: notionRedirectUri(requestOrigin(request)),
  });
}, "GET /api/notion/status");
