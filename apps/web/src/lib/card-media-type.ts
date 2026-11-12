/**
 * Types that say nothing about the bytes. A multipart part sent without its own
 * Content-Type is read as text/plain (RFC 7578 §4.4), and that is how the phone
 * sends local files: expo/fetch reads `file://` URIs into blobs with no type, so
 * expo's multipart encoder writes the part with a filename and no Content-Type.
 */
const UNTYPED = new Set(["", "application/octet-stream", "text/plain"]);

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** The card media type the leading bytes identify, or null when they don't match one. */
export function sniffCardMediaType(head: Uint8Array): string | null {
  if (head.length < 4) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(head, 0, 4) === "GIF8") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF") {
    const format = ascii(head, 8, 12);
    if (format === "WEBP") return "image/webp";
    if (format === "WAVE") return "audio/wav";
    return null;
  }
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "audio/webm";
  if (ascii(head, 0, 3) === "ID3") return "audio/mpeg";
  if (ascii(head, 4, 8) === "ftyp") {
    // iOS recordings are "M4A "; other MPEG-4 audio uses the generic brands.
    const brand = ascii(head, 8, 12);
    if (/^(M4A |M4B |mp4[12]|isom|iso[2-6])$/.test(brand)) return "audio/mp4";
    return null;
  }
  // MPEG audio frame sync: ADTS AAC has layer bits 00, MP3 does not.
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    return (head[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }
  return null;
}

/**
 * The MIME type to validate and store a card media upload as. A declared type is
 * trusted (minus any parameters); an untyped part is identified by its bytes,
 * then by its file name. The phone's image picker re-encodes HEIC to JPEG but
 * keeps the .HEIC name, so the bytes come first.
 */
export function resolveCardMediaType(declared: string, filename: string, head: Uint8Array): string {
  const type = declared.split(";")[0].trim().toLowerCase();
  if (!UNTYPED.has(type)) return type;
  const sniffed = sniffCardMediaType(head);
  if (sniffed) return sniffed;
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return TYPE_BY_EXTENSION[extension] ?? type;
}
