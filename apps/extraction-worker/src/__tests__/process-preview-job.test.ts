import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { convertToPdf, extensionForFilename } from "../process-preview-job.js";

const execFileAsync = promisify(execFile);

// Minimal single-paragraph DOCX ("Preview conversion test") built with zipfile.
const TINY_DOCX_BASE64 =
  "UEsDBBQAAAAIAGxU9FzJTxqw6wAAAK4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QvU7DMBDeeQrLK4odGBBCSTrwMwJDeYCTfUks7LPlc0v79jht6YAK4933q69b7YIXW8zsIvXyRrVSIJloHU29/Fi/NPdScAGy4CNhL/fIcjVcdet9QhZVTNzLuZT0oDWbGQOwigmpImPMAUo986QTmE+YUN+27Z02kQpSacriIYfuCUfY+CKed/V9LJLRsxSPR+KS1UtIyTsDpeJ6S/ZXSnNKUFV54PDsEl9XgtQXExbk74CT7q0uk51F8Q65vEKoLP0Vs9U2mk2oSvW/zYWecRydwbN+cUs5GmSukwevzkgARz/99WHu4RtQSwMEFAAAAAgAbFT0XLmBRHGwAAAAKgEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4J1TRN5pWgaEUJMuCKkrKgeIEjeNaB5KwqO3JwMDIAZG278/y233sDO5YUzGOwZNVQNBJ70yTjM4D8f1DkjKwikxe4cMFkzQ8VV7wlnkspMmExIpiEsMppzDntIkJ7QiVT6gK5PRRytyKaOmQciL0Eg3db2l8d0A/mGSXjGIvWqADEvAf2w/jkbiwcurRZd/nPhKFFlEjZnB3UdF1atdFRYob+nHi/wJUEsDBBQAAAAIAGxU9FxnD4evpgAAAOEAAAARAAAAd29yZC9kb2N1bWVudC54bWxFjjsOwjAQRHtOYbknDhQIRfl01BRwAGMvSaR41/KahNweOyDRvNFqpLdTd283iRkCj4SNPBSlFICG7Ih9I++3y/4sBUeNVk+E0MgVWHbtrl4qS+blAKNIBuRqaeQQo6+UYjOA01yQB0zdk4LTMZ2hVwsF6wMZYE4P3KSOZXlSTo8o26R8kF1z+oyQEdtrgHmERRjC30wRgWOtcpkZNvqNX4H6j2s/UEsBAhQDFAAAAAgAbFT0XMlPGrDrAAAArgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABsVPRcuYFEcbAAAAAqAQAACwAAAAAAAAAAAAAAgAEcAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACABsVPRcZw+Hr6YAAADhAAAAEQAAAAAAAAAAAAAAgAH1AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAygIAAAAA";

async function libreOfficeAvailable(): Promise<boolean> {
  try {
    await execFileAsync("soffice", ["--version"], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const hasSoffice = await libreOfficeAvailable();
const scratchDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    scratchDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("extensionForFilename", () => {
  it("keeps known Office extensions and defaults to docx", () => {
    expect(extensionForFilename("Deck.PPTX")).toBe("pptx");
    expect(extensionForFilename("notes.doc")).toBe("doc");
    expect(extensionForFilename("mystery.bin")).toBe("docx");
    expect(extensionForFilename("no-extension")).toBe("docx");
  });
});

describe.skipIf(!hasSoffice)("convertToPdf (requires LibreOffice)", () => {
  it("converts a DOCX to a non-empty PDF", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "preview-test-"));
    scratchDirs.push(scratch);
    const input = join(scratch, "sample.docx");
    await writeFile(input, Buffer.from(TINY_DOCX_BASE64, "base64"));

    const pdfPath = await convertToPdf(input, scratch);
    const pdf = await readFile(pdfPath);
    expect(pdfPath.endsWith("sample.pdf")).toBe(true);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 120_000);
});
