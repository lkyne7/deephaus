import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  buildCardExplainState,
  type CardExplainKind,
  type CardExplainState,
  type CardExplanationRow,
} from "@deephaus/shared";

type LocalCardRow = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  source_quote: string | null;
  source_id: string | null;
  source_title: string | null;
};

/**
 * A saved Hint/Explain result from the local replica, in the same shape the API
 * returns. Null when the card is not in the replica (fall back to the network);
 * a card with nothing saved returns an empty state.
 */
export async function getLocalCardExplanation(
  db: AbstractPowerSyncDatabase,
  cardId: string,
  options: { kind: CardExplainKind; clozeOrd?: number | null },
): Promise<CardExplainState | null> {
  const card = await db.getOptional<LocalCardRow>(
    `SELECT c.id, c.type, c.front, c.back, c.cloze_text, c.extra, c.source_quote,
            s.id AS source_id, s.title AS source_title
       FROM cards c
       LEFT JOIN generation_jobs j ON j.id = c.job_id
       LEFT JOIN sources s ON s.id = j.source_id
      WHERE c.id = ?`,
    [cardId],
  );
  if (!card) return null;

  const row = await db.getOptional<CardExplanationRow>(
    `SELECT card_id, content_hash, explanation, hints, thread, updated_at
       FROM card_explanations
      WHERE card_id = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [cardId],
  );

  let confusable: CardExplainState["confusable"] = null;
  if (options.kind === "explain" && row?.explanation) {
    const body = typeof row.explanation === "string" ? safeParse(row.explanation) : row.explanation;
    const id = (body as { confusable?: { card_id?: string } } | null)?.confusable?.card_id;
    if (id) {
      confusable =
        (await db.getOptional<NonNullable<CardExplainState["confusable"]>>(
          `SELECT id, type, front, back, cloze_text, extra FROM cards WHERE id = ?`,
          [id],
        )) ?? null;
    }
  }

  return buildCardExplainState(
    row,
    {
      card,
      source: card.source_id ? { id: card.source_id, title: card.source_title } : null,
      findCard: () => confusable,
    },
    options,
  );
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
