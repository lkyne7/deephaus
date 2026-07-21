import { describe, expect, it } from "vitest";
import { extractPdfHybrid } from "../hybrid.js";

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("hybrid fallback", () => {
  it("uses the best local result when an OCR route has no provider available", async () => {
    const result = await extractPdfHybrid({ data: minimalPdf("Scanned fallback") });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.inspection?.route).toBe("ocr");
    expect(result.pages[0]?.provider).toBe("local-fallback");
    expect(result.pages[0]?.markdown).toContain("Scanned fallback");
  });

  it("does not silently flatten equations when math-aware OCR is unavailable", async () => {
    const pdf = minimalPdf(
      "The attention equation is softmax(QK) and must preserve mathematical structure.",
    );
    await expect(extractPdfHybrid({ data: pdf })).rejects.toThrow(
      "Math-aware OCR could not preserve equations on page 1",
    );
  });
});
