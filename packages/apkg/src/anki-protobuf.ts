/**
 * Minimal, schema-less protobuf scanner.
 *
 * Anki's modern collections store deck presets (`deck_config.config`) and a
 * deck's preset id (`decks.kind`) as protobuf blobs. We don't ship Anki's
 * .proto, so instead of full decoding we walk the wire format and pull out the
 * couple of fields we need heuristically:
 *
 *   - FSRS weights:        a packed `repeated float` (length-delimited, 4·N bytes)
 *   - desired retention:   a standalone 32-bit float in (0, 1)
 *   - a deck's preset id:   a varint nested under the Normal message
 *
 * Every extractor is defensive: malformed input yields `undefined`, never throws.
 */

export type ProtoField = {
  field: number;
  wire: number;
  /** varint / fixed value (number) */
  value?: number;
  /** length-delimited payload */
  bytes?: Uint8Array;
};

function readVarint(buf: Uint8Array, pos: number): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let p = pos;
  while (p < buf.length) {
    const byte = buf[p];
    result += (byte & 0x7f) * 2 ** shift;
    p += 1;
    if ((byte & 0x80) === 0) return { value: result, next: p };
    shift += 7;
    if (shift > 63) return null;
  }
  return null;
}

/** Walk the top-level fields of a protobuf message. Returns [] on any error. */
export function scanProtoFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (!tag) break;
    pos = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (field === 0) break;

    if (wire === 0) {
      const v = readVarint(buf, pos);
      if (!v) break;
      fields.push({ field, wire, value: v.value });
      pos = v.next;
    } else if (wire === 1) {
      if (pos + 8 > buf.length) break;
      fields.push({ field, wire, value: view.getFloat64(pos, true) });
      pos += 8;
    } else if (wire === 2) {
      const len = readVarint(buf, pos);
      if (!len) break;
      const start = len.next;
      const end = start + len.value;
      if (end > buf.length) break;
      fields.push({ field, wire, bytes: buf.subarray(start, end) });
      pos = end;
    } else if (wire === 5) {
      if (pos + 4 > buf.length) break;
      fields.push({ field, wire, value: view.getFloat32(pos, true) });
      pos += 4;
    } else {
      break; // groups (3/4) and unknown wire types are unsupported
    }
  }

  return fields;
}

/** Decode a length-delimited payload as a packed `repeated float`. */
function decodePackedFloats(bytes: Uint8Array): number[] | null {
  if (bytes.length === 0 || bytes.length % 4 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const f = view.getFloat32(i, true);
    if (!Number.isFinite(f)) return null;
    out.push(f);
  }
  return out;
}

/**
 * Parse a modern Anki `media` manifest (protobuf `MediaEntries`).
 *
 *   message MediaEntries { repeated MediaEntry entries = 1; }
 *   message MediaEntry   { string name = 1; uint32 size = 2; bytes sha1 = 3; }
 *
 * Returns filenames in entry order; index `i` maps to the zip file named `i`.
 * Returns [] when the blob isn't a parseable MediaEntries message.
 */
export function parseMediaEntries(buf: Uint8Array): string[] {
  let fields: ProtoField[];
  try {
    fields = scanProtoFields(buf);
  } catch {
    return [];
  }
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (const entry of fields) {
    if (entry.field !== 1 || entry.wire !== 2 || !entry.bytes) continue;
    const inner = scanProtoFields(entry.bytes);
    const nameField = inner.find((f) => f.field === 1 && f.wire === 2 && f.bytes);
    names.push(nameField?.bytes ? decoder.decode(nameField.bytes) : "");
  }
  return names;
}

export type AnkiDeckPreset = {
  /** FSRS weights, if a packed float array of an expected length was found. */
  fsrsParams?: number[];
  /** Desired retention in (0,1), if a plausible float field was found. */
  desiredRetention?: number;
};

/**
 * Extract FSRS preset data from a `deck_config.config` protobuf blob.
 *
 * @param expectedParamCount  param length to accept (the installed ts-fsrs
 *                            algorithm's `default_w.length`). Other known FSRS
 *                            lengths are rejected as version-incompatible.
 */
export function extractDeckPreset(
  config: Uint8Array,
  expectedParamCount: number,
): AnkiDeckPreset {
  const preset: AnkiDeckPreset = {};
  let fields: ProtoField[];
  try {
    fields = scanProtoFields(config);
  } catch {
    return preset;
  }

  for (const f of fields) {
    if (f.wire === 2 && f.bytes && !preset.fsrsParams) {
      const floats = decodePackedFloats(f.bytes);
      if (
        floats &&
        floats.length === expectedParamCount &&
        floats.every((n) => n > -100 && n < 1000) &&
        floats.some((n) => Math.abs(n) > 1e-4)
      ) {
        preset.fsrsParams = floats;
      }
    }

    if (f.wire === 5 && typeof f.value === "number" && preset.desiredRetention == null) {
      if (f.value >= 0.7 && f.value <= 0.99) {
        preset.desiredRetention = Math.round(f.value * 1000) / 1000;
      }
    }
  }

  // Only trust desired retention when real FSRS weights are present — otherwise
  // a coincidental float in a non-FSRS deck config could be misread.
  if (!preset.fsrsParams) delete preset.desiredRetention;

  return preset;
}

/**
 * Best-effort extraction of a deck's preset (config) id from a `decks.kind`
 * protobuf blob. The Normal message lives at field 1; its config_id is field 1
 * within it. Returns undefined for filtered decks or on any parse failure.
 */
export function extractDeckConfigId(kind: Uint8Array): number | undefined {
  let fields: ProtoField[];
  try {
    fields = scanProtoFields(kind);
  } catch {
    return undefined;
  }
  const normal = fields.find((f) => f.field === 1 && f.wire === 2 && f.bytes);
  if (!normal?.bytes) return undefined;
  const inner = scanProtoFields(normal.bytes);
  const configId = inner.find((f) => f.field === 1 && f.wire === 0);
  return configId?.value;
}
