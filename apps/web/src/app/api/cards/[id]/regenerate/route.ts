import { withApiTiming } from "@/lib/perf/with-api-timing";
import { rewriteCardRoute } from "@/lib/cards/rewrite-card";

/**
 * POST /api/cards/[id]/regenerate
 * ---------------------------------------------------------------------
 * One-click "regenerate this card": rewrites the card's content fields from
 * the passage it was generated from (falling back to the card itself when no
 * source is linked). The card type, tags and scheduling are kept. Costs one
 * AI credit; uses a deterministic mock when no LLM key is set.
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rewriteCardRoute(request, id, "regenerate");
}, "POST /api/cards/[id]/regenerate");
