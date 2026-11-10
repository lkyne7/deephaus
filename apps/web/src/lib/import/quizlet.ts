export const MAX_QUIZLET_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_QUIZLET_IMPORT_CARDS = 20_000;

export type QuizletCard = {
  term: string;
  definition: string;
};

export type QuizletSkippedRow = {
  /** 1-based line in the pasted text where the row starts. */
  line: number;
  reason: "missing_term" | "missing_definition";
};

export type QuizletParseResult = {
  cards: QuizletCard[];
  skipped: QuizletSkippedRow[];
};

type Delimiter = "\t" | ",";

type ParsedRow = {
  line: number;
  cells: string[];
};

function detectDelimiter(value: string): Delimiter {
  const sample = value.split(/\r?\n/).slice(0, 20).join("\n");
  return (sample.match(/\t/g)?.length ?? 0) > 0 ? "\t" : ",";
}

function isRowEnd(value: string, index: number): boolean {
  const char = value[index];
  return char === undefined || char === "\n" || char === "\r";
}

/**
 * Try to read a CSV-style quoted field starting at `start` (the opening
 * quote). Returns null when the field is not validly quoted: a quote that is
 * neither doubled nor followed by the delimiter or the end of the row means
 * the quotes are literal text, as in `"DNA" is a molecule`.
 */
function readQuotedField(
  value: string,
  start: number,
  delimiter: Delimiter,
): { cell: string; end: number; needsQuoting: boolean } | null {
  let cell = "";
  let needsQuoting = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '"') {
      if (char === delimiter || char === "\n" || char === "\r") needsQuoting = true;
      cell += char;
      continue;
    }
    if (value[index + 1] === '"') {
      cell += '"';
      needsQuoting = true;
      index += 1;
      continue;
    }
    const next = index + 1;
    if (value[next] === delimiter || isRowEnd(value, next)) {
      return { cell, end: next, needsQuoting };
    }
    return null;
  }
  return null;
}

function parseRows(value: string, delimiter: Delimiter): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let cells: string[] = [];
  let line = 1;
  let rowLine = 1;
  let index = 0;

  const countLines = (text: string) => {
    line += text.match(/\r\n|\r|\n/g)?.length ?? 0;
  };

  while (index <= value.length) {
    let cell = "";
    if (value[index] === '"') {
      const quoted = readQuotedField(value, index, delimiter);
      // Tab-separated exports (Quizlet's own format) never quote fields, so a
      // field like `"Hello"` keeps its quotes unless quoting was needed to
      // hold a tab, a line break or an escaped quote.
      if (quoted && (delimiter === "," || quoted.needsQuoting)) {
        cell = quoted.cell;
        countLines(value.slice(index, quoted.end));
        index = quoted.end;
      }
    }

    // Read the rest of the field (or all of it, when it wasn't quoted)
    // literally up to the next delimiter or line break.
    while (index < value.length && value[index] !== delimiter && !isRowEnd(value, index)) {
      cell += value[index];
      index += 1;
    }
    cells.push(cell);

    if (value[index] === delimiter) {
      index += 1;
      continue;
    }

    rows.push({ line: rowLine, cells });
    cells = [];
    if (index >= value.length) break;
    index += value[index] === "\r" && value[index + 1] === "\n" ? 2 : 1;
    line += 1;
    rowLine = line;
  }

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
 *
 * Blank lines are ignored. Any other row without both a term and a
 * definition is reported in `skipped` with its line number, so callers can
 * tell the user exactly what would be left out.
 */
export function parseQuizletImport(value: string): QuizletParseResult {
  const normalized = value.replace(/^\uFEFF/, "");
  if (!normalized.trim()) return { cards: [], skipped: [] };

  const delimiter = detectDelimiter(normalized);
  const cards: QuizletCard[] = [];
  const skipped: QuizletSkippedRow[] = [];
  let sawFirstRow = false;

  for (const row of parseRows(normalized, delimiter)) {
    const term = (row.cells[0] ?? "").trim();
    const definition = row.cells.slice(1).join(delimiter).trim();
    if (!term && !definition) continue;

    const card = { term, definition };
    const isFirstRow = !sawFirstRow;
    sawFirstRow = true;
    if (isFirstRow && isHeader(card)) continue;

    if (!term) {
      skipped.push({ line: row.line, reason: "missing_term" });
    } else if (!definition) {
      skipped.push({ line: row.line, reason: "missing_definition" });
    } else {
      cards.push(card);
    }
  }

  return { cards, skipped };
}

export function parseQuizletExport(value: string): QuizletCard[] {
  return parseQuizletImport(value).cards;
}

/** e.g. "The rows on lines 2, 5 and 9 are missing a term or definition." */
export function describeSkippedRows(skipped: QuizletSkippedRow[], limit = 8): string {
  const lines = skipped.map((row) => String(row.line));
  const shown = lines.slice(0, limit);
  const extra = lines.length - shown.length;
  if (lines.length === 1) {
    return `The row on line ${lines[0]} is missing a term or definition.`;
  }
  const list =
    extra > 0
      ? `${shown.join(", ")} and ${extra.toLocaleString()} more`
      : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return `The rows on lines ${list} are missing a term or definition.`;
}
