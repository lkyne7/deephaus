import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdfHybrid } from "../hybrid.js";

async function imagePdf(): Promise<Uint8Array> {
  const diagram = createCanvas(640, 320);
  const context = diagram.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, diagram.width, diagram.height);
  context.fillStyle = "#dbeafe";
  context.fillRect(180, 80, 280, 160);
  context.strokeStyle = "#1d4ed8";
  context.lineWidth = 8;
  context.strokeRect(180, 80, 280, 160);
  context.fillStyle = "#111827";
  context.font = "bold 34px sans-serif";
  context.fillText("MITOCHONDRION", 175, 55);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(diagram.toBuffer("image/png"));
  page.drawText("Cell biology diagram", {
    x: 48,
    y: 730,
    size: 20,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawImage(image, { x: 48, y: 300, width: 516, height: 258 });
  return pdf.save();
}

describe("local PDF image extraction", () => {
  it("preserves embedded figures when OCR is unavailable", async () => {
    const document = await extractPdfHybrid({
      data: await imagePdf(),
      includeImages: true,
    });

    expect(document.pages).toHaveLength(1);
    const imageBlocks = document.pages[0]!.blocks.filter(
      (block) => block.kind === "image",
    );
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]!.image?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(document.pages[0]!.markdown).toContain("![Figure on page 1]");
  });

  it("omits figure payloads when image extraction is disabled", async () => {
    const document = await extractPdfHybrid({
      data: await imagePdf(),
      includeImages: false,
    });

    expect(document.pages[0]!.blocks.some((block) => block.kind === "image")).toBe(false);
  });
});
