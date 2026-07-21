import ExcelJS from "exceljs";
import { stripNullBytes } from "@deephaus/pdf-extraction";

const MAX_SHEETS = 200;
const MAX_ROWS_PER_SHEET = 20_000;
const MAX_COLUMNS_PER_ROW = 256;
const MAX_CELLS = 250_000;
const MAX_TEXT_CHARS = 4_000_000;
const MIN_TEXT_CHARS = 20;

type CellValue = ExcelJS.CellValue;

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if ("richText" in value) return value.richText.map((part) => part.text ?? "").join("");
  if ("formula" in value) {
    return value.result === undefined ? (value.formula ?? "") : cellText(value.result as CellValue);
  }
  if ("hyperlink" in value) return value.text || value.hyperlink || "";
  if ("error" in value) return value.error ?? "";
  return String(value);
}

/**
 * Extract every non-empty worksheet into tab-separated text while retaining
 * sheet boundaries for chunking and source references.
 */
export async function extractXlsxText(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  if (workbook.worksheets.length === 0) {
    throw new Error("No worksheets found in this spreadsheet.");
  }
  if (workbook.worksheets.length > MAX_SHEETS) {
    throw new Error(`Spreadsheet has too many worksheets (max ${MAX_SHEETS}).`);
  }

  let totalCells = 0;
  let totalChars = 0;
  const sections: string[] = [];

  for (const sheet of workbook.worksheets) {
    if (sheet.actualRowCount > MAX_ROWS_PER_SHEET) {
      throw new Error(
        `Worksheet "${sheet.name}" has too many rows (max ${MAX_ROWS_PER_SHEET.toLocaleString()}).`,
      );
    }

    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const columns: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (columnNumber > MAX_COLUMNS_PER_ROW) return;
        const text = stripNullBytes(cellText(cell.value)).replace(/\r?\n/g, " ").trim();
        if (!text) return;
        columns[columnNumber - 1] = text;
        totalCells += 1;
        totalChars += text.length;
      });
      if (columns.length > 0) lines.push(columns.map((value) => value ?? "").join("\t"));
    });

    if (totalCells > MAX_CELLS || totalChars > MAX_TEXT_CHARS) {
      throw new Error("Spreadsheet is too large to extract safely.");
    }
    if (lines.length > 0) {
      sections.push(`--- Sheet: ${sheet.name} ---\n\n${lines.join("\n")}`);
    }
  }

  const text = sections.join("\n\n").trim();
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error("Could not extract enough readable data from this spreadsheet.");
  }

  return { text, pageCount: workbook.worksheets.length };
}
