import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

async function labeledDiagramPdf(): Promise<Buffer> {
  const diagram = createCanvas(640, 320);
  const context = diagram.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, diagram.width, diagram.height);
  context.fillStyle = "#fee2e2";
  context.fillRect(170, 95, 300, 150);
  context.strokeStyle = "#991b1b";
  context.lineWidth = 7;
  context.strokeRect(170, 95, 300, 150);
  context.fillStyle = "#111827";
  context.font = "bold 32px sans-serif";
  context.fillText("LEFT VENTRICLE", 170, 68);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(diagram.toBuffer("image/png"));
  page.drawText(
    "Cardiac anatomy diagram showing the left ventricle and surrounding structures.",
    { x: 48, y: 735, size: 14, font },
  );
  page.drawImage(image, { x: 48, y: 300, width: 516, height: 258 });
  return Buffer.from(await pdf.save());
}

describe("document image extraction", () => {
  it("renders useful PDF figure crops for auto-occlusion", async () => {
    const { extractSourceImages } = await import("../extract-images");
    const images = await extractSourceImages(await labeledDiagramPdf(), "pdf");

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      mime: "image/png",
      ref: "Page 1",
    });
    expect(images[0]!.width).toBeGreaterThanOrEqual(200);
    expect(images[0]!.height).toBeGreaterThanOrEqual(200);
    expect(images[0]!.bytes.subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
  });

  it("uploads extracted figures and places them in editable source content", async () => {
    const pdf = await labeledDiagramPdf();
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://media.example/source-figure.png" },
    });
    const supabase = {
      storage: {
        from: vi.fn((bucket: string) =>
          bucket === "pdfs"
            ? {
                download: vi.fn().mockResolvedValue({
                  data: new Blob([Uint8Array.from(pdf)]),
                }),
              }
            : { upload, getPublicUrl },
        ),
      },
    };

    const { buildSourceDocument } = await import("../source-document");
    const result = await buildSourceDocument(
      supabase as never,
      "user-1",
      {
        id: "source-1",
        type: "pdf",
        raw_text:
          "--- Page 1 ---\n\nCardiac anatomy diagram showing the left ventricle.",
        storage_path: "user-1/project-1/diagram.pdf",
        extract_images: true,
      },
    );

    const image = result.content.content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({
      src: "https://media.example/source-figure.png",
      alt: "Page 1",
    });
    expect(upload).toHaveBeenCalledOnce();
  });
});
