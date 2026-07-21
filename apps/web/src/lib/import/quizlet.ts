export const MAX_QUIZLET_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_QUIZLET_IMPORT_CARDS = 20_000;

export type QuizletCard = {
  term: string;
  definition: string;
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

function isHeader(card: QuizletCard): boolean {
  const term = card.term.toLowerCase();
  const definition = card.definition.toLowerCase();
  return (
    (term === "term" || term === "word" || term === "question") &&
    (definition === "definition" || definition === "answer")
  );
}

/**
 * Parse Quizlet's exported tab-separated text. Comma-separated exports are
 * accepted as a convenience, including quoted commas and multiline values.
 */
export function parseQuizletExport(value: string): QuizletCard[] {
  const normalized = value.replace(/^\uFEFF/, "").trim();
  if (!normalized) return [];

  const delimiter = detectDelimiter(normalized);
  const cards = parseRows(normalized, delimiter)
    .map((row) => ({
      term: (row[0] ?? "").trim(),
      definition: row.slice(1).join(delimiter).trim(),
    }))
    .filter((card) => card.term.length > 0 && card.definition.length > 0);

  if (cards[0] && isHeader(cards[0])) cards.shift();
  return cards;
}
