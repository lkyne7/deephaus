import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cramErrorResponse } from "@/lib/cram/http";
import { getCramQueue } from "@/lib/cram/service";
import { withApiTiming } from "@/lib/perf/with-api-timing";

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  continue: z.enum(["0", "1"]).default("0"),
});

export const GET = withApiTiming(async function GET(
  request: Request,
  { params }: RouteContext,
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const id = z.string().uuid().parse((await params).id);
    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      continue: url.searchParams.get("continue") ?? undefined,
    });
    return NextResponse.json(
      await getCramQueue(supabase, user!.id, id, {
        limit: query.limit,
        continuePastBudget: query.continue === "1",
      }),
    );
  } catch (error) {
    return cramErrorResponse(error);
  }
}, "GET /api/cram-plans/[id]/queue");
