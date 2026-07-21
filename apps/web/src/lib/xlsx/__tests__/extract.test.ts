import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractXlsxText } from "@/lib/xlsx/extract";

async function workbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const anatomy = workbook.addWorksheet("Anatomy");
  anatomy.addRow(["Structure", "Function"]);
  anatomy.addRow(["Alveoli", "Gas exchange"]);
  const doses = workbook.addWorksheet("Doses");
  doses.addRow(["Medication", "Dose"]);
  doses.addRow(["Example", 25]);
  doses.getCell("C2").value = { formula: "B2*2", result: 50 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("extractXlsxText", () => {
  it("extracts all worksheets with names and tab-separated rows", async () => {
    const result = await extractXlsxText(await workbookBuffer());
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("--- Sheet: Anatomy ---");
    expect(result.text).toContain("Alveoli\tGas exchange");
    expect(result.text).toContain("--- Sheet: Doses ---");
    expect(result.text).toContain("Example\t25\t50");
  });

  it("rejects empty workbooks", async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(extractXlsxText(buffer)).rejects.toThrow("No worksheets");
  });
});
