import { withApiTiming } from "@/lib/perf/with-api-timing";
import { rewriteCardRoute } from "@/lib/cards/rewrite-card";

/**
 * POST /api/cards/[id]/mnemonic
 * ---------------------------------------------------------------------
 * One-click "make this a mnemonic card": rewrites the card's text in the
 * AnKing style — the topic, the mnemonic word in quotes, then one item per
 * line with its cue letter bold + underlined (for cloze cards the mnemonic and
 * items are c1, the topic c2). The card stays the same type; only its content
 * fields change. Costs one AI credit; uses a deterministic mock when no LLM
 * key is set.
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rewriteCardRoute(request, id, "mnemonic");
}, "POST /api/cards/[id]/mnemonic");
