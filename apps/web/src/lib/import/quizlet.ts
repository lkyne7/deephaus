export const MAX_QUIZLET_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_QUIZLET_IMPORT_CARDS = 20_000;

export type QuizletCard = {
  term: string;
  definition: string;
  tags?: string[];
};

function detectDelimiter(value: string): "\t" | "," {
  const sample = value.split(/\r?\n/).slice(0, 20).join("\n");
  return (sample.match(/\t/g)?.length ?? 0) > 0 ? "\t" : ",";
}

function parseRows(value: string, delimiter: "\t" | ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

const FRONT_HEADERS = new Set(["front", "term", "word", "question"]);
const BACK_HEADERS = new Set(["back", "definition", "answer"]);
const TAG_HEADERS = new Set(["tag", "tags"]);

type HeaderMapping = {
  term: number;
  definition: number;
  tags: number | null;
};

function headerName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function headerMapping(row: string[]): HeaderMapping | null {
  const names = row.map(headerName);
  const term = names.findIndex((name) => FRONT_HEADERS.has(name));
  const definition = names.findIndex((name) => BACK_HEADERS.has(name));
  if (term < 0 || definition < 0 || term === definition) return null;
  const tags = names.findIndex((name) => TAG_HEADERS.has(name));
  return { term, definition, tags: tags >= 0 ? tags : null };
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * Parse Quizlet's exported tab-separated text. Comma-separated exports are
 * accepted as a convenience, including quoted commas and multiline values.
 * Header-based files map recognized front/back/tags columns and ignore unknown
 * columns. Headerless files retain the legacy behavior of joining every column
 * after the first into the definition.
 */
export function parseQuizletExport(value: string): QuizletCard[] {
  const normalized = value.replace(/^\uFEFF/, "").trim();
  if (!normalized) return [];

  const delimiter = detectDelimiter(normalized);
  const rows = parseRows(normalized, delimiter);
  const mapping = rows[0] ? headerMapping(rows[0]) : null;
  const dataRows = mapping ? rows.slice(1) : rows;

  return dataRows
    .map((row): QuizletCard => {
      const term = (row[mapping?.term ?? 0] ?? "").trim();
      const definition = (
        mapping ? row[mapping.definition] ?? "" : row.slice(1).join(delimiter)
      ).trim();
      const tags = mapping?.tags == null ? [] : parseTags(row[mapping.tags] ?? "");
      return tags.length > 0 ? { term, definition, tags } : { term, definition };
    })
    .filter((card) => card.term.length > 0 && card.definition.length > 0);
}
