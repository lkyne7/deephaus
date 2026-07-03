import mammoth from "mammoth";

export type DocxImageHandler = (
  bytes: Buffer,
  mime: string,
) => Promise<string | null>;

/**
 * Convert a Word document to HTML with inline images. Each embedded image is
 * handed to `onImage`, which uploads it and returns a URL; images that fail to
 * upload are dropped (their `src` becomes empty and is ignored downstream).
 */
export async function extractDocxHtml(
  buffer: Buffer,
  onImage: DocxImageHandler,
): Promise<string> {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const base64 = await image.read("base64");
          const bytes = Buffer.from(base64, "base64");
          const src = await onImage(bytes, image.contentType ?? "image/png");
          return { src: src ?? "" };
        } catch {
          return { src: "" };
        }
      }),
    },
  );
  return result.value?.trim() ?? "";
}
