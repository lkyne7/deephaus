declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfData {
    text: string;
    numpages: number;
  }
  export default function pdf(buffer: Buffer): Promise<PdfData>;
}
