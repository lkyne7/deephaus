import type { AbstractPowerSyncDatabase } from "@powersync/common";

/** Mirrors the web BrowseCardRow (api-client shape). */
export interface LocalBrowseCardRow {
  id: string;
  deck_id: string;
  deck_name: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  tags: string[];
  sort_order: number;
  user_edited: boolean;
  suspended: boolean;
  source_ref?: string | null;
  source_quote?: string | null;
}

export interface LocalBrowseFilters {
  decks: Array<{ id: string; name: string }>;
  tags: string[];
}

export interface LocalBrowseResult {
  cards: LocalBrowseCardRow[];
  total: number;
  limit: number;
  offset: number;
  filters?: LocalBrowseFilters | null;
}

export interface LocalBrowseParams {
  deck_id?: string;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
  filters?: boolean;
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const BROWSE_SELECT = `
  c.id,
  p.id AS deck_id,
  COALESCE(NULLIF(p.deck_name, ''), p.name) AS deck_name,
  c.type,
  c.front,
  c.back,
  c.cloze_text,
  c.extra,
  c.occlusion_data,
  c.tags,
  c.sort_order,
  c.user_edited,
  c.source_ref,
  c.source_quote,
  COALESCE((
    SELECT MAX(cr.suspended) FROM card_reviews cr WHERE cr.card_id = c.id
  ), 0) AS suspended`;

const BROWSE_FROM = `
  FROM cards c
  JOIN generation_jobs gj ON gj.id = c.job_id
  JOIN sources s ON s.id = gj.source_id
  JOIN projects p ON p.id = s.project_id`;

function buildBrowseWhere(params: LocalBrowseParams): { where: string; args: unknown[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (params.deck_id) {
    clauses.push("p.id = ?");
    args.push(params.deck_id);
  }
  if (params.tag) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)");
    args.push(params.tag);
  }
  const search = params.q?.trim();
  if (search) {
    clauses.push(
      `(COALESCE(c.front, '') LIKE ? OR COALESCE(c.back, '') LIKE ? OR
        COALESCE(c.cloze_text, '') LIKE ? OR COALESCE(c.extra, '') LIKE ?)`,
    );
    const pattern = `%${search}%`;
    args.push(pattern, pattern, pattern, pattern);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

function rowToBrowseCard(row: Record<string, unknown>): LocalBrowseCardRow {
  return {
    id: String(row.id),
    deck_id: String(row.deck_id),
    deck_name: String(row.deck_name ?? ""),
    type: String(row.type) as LocalBrowseCardRow["type"],
    front: (row.front as string | null) ?? null,
    back: (row.back as string | null) ?? null,
    cloze_text: (row.cloze_text as string | null) ?? null,
    extra: (row.extra as string | null) ?? null,
    occlusion_data: parseJson(row.occlusion_data),
    tags: parseTags(row.tags),
    sort_order: Number(row.sort_order ?? 0),
    user_edited: Number(row.user_edited ?? 0) !== 0,
    suspended: Number(row.suspended ?? 0) !== 0,
    source_ref: (row.source_ref as string | null) ?? null,
    source_quote: (row.source_quote as string | null) ?? null,
  };
}

/** Local mirror of GET /api/projects (all rows are the user's own). */
export async function listLocalProjects(db: AbstractPowerSyncDatabase): Promise<
  Array<{
    id: string;
    user_id: string;
    name: string;
    deck_name: string;
    settings: unknown;
    created_at: string;
    updated_at: string;
  }>
> {
  const rows = await db.getAll<Record<string, unknown>>(
    `SELECT id, user_id, name, deck_name, settings, created_at, updated_at
     FROM projects ORDER BY updated_at DESC`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id ?? ""),
    name: String(row.name ?? ""),
    deck_name: String(row.deck_name ?? row.name ?? ""),
    settings: parseJson(row.settings) ?? {},
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  }));
}

/** Local filter options: decks by recency plus distinct tags (scoped to deck). */
export async function getLocalBrowseFilters(
  db: AbstractPowerSyncDatabase,
  deckId?: string,
): Promise<LocalBrowseFilters> {
  const [projects, tagRows] = await Promise.all([
    db.getAll<{ id: string; name: string; deck_name: string | null }>(
      `SELECT id, name, deck_name FROM projects ORDER BY updated_at DESC`,
    ),
    db.getAll<{ tag: string }>(
      `SELECT DISTINCT json_each.value AS tag
       FROM cards c
       JOIN generation_jobs gj ON gj.id = c.job_id
       JOIN sources s ON s.id = gj.source_id
       JOIN projects p ON p.id = s.project_id, json_each(c.tags)
       ${deckId ? "WHERE p.id = ?" : ""}
       ORDER BY tag`,
      deckId ? [deckId] : [],
    ),
  ]);
  return {
    decks: projects.map((p) => ({ id: p.id, name: p.deck_name || p.name })),
    tags: tagRows.map((r) => r.tag).filter((t) => typeof t === "string" && t.length > 0),
  };
}

/** Local mirror of the browse_cards RPC (deck/tag/search filters + paging). */
export async function browseLocalCards(
  db: AbstractPowerSyncDatabase,
  params: LocalBrowseParams = {},
): Promise<LocalBrowseResult> {
  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);
  const { where, args } = buildBrowseWhere(params);

  const [rows, countRow, filters] = await Promise.all([
    db.getAll<Record<string, unknown>>(
      `SELECT ${BROWSE_SELECT} ${BROWSE_FROM} ${where}
       ORDER BY deck_name, c.sort_order, c.id
       LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    ),
    db.get<{ count: number }>(
      `SELECT COUNT(*) AS count ${BROWSE_FROM} ${where}`,
      args,
    ),
    params.filters ? getLocalBrowseFilters(db, params.deck_id) : Promise.resolve(null),
  ]);

  return {
    cards: rows.map(rowToBrowseCard),
    total: Number(countRow?.count ?? 0),
    limit,
    offset,
    filters,
  };
}

/** Single card with deck context, matching GET /api/cards/[id]. */
export async function getLocalBrowseCard(
  db: AbstractPowerSyncDatabase,
  cardId: string,
): Promise<LocalBrowseCardRow | null> {
  const row = await db.getOptional<Record<string, unknown>>(
    `SELECT ${BROWSE_SELECT} ${BROWSE_FROM} WHERE c.id = ?`,
    [cardId],
  );
  return row ? rowToBrowseCard(row) : null;
}
