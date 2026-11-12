import { describe, expect, it } from "vitest";

import { resolveCardMediaType, sniffCardMediaType } from "@/lib/card-media-type";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe("sniffCardMediaType", () => {
  it.each([
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe1)],
    ["image/png", bytes(0x89, "PNG\r\n", 0x1a, "\n")],
    ["image/gif", bytes("GIF89a")],
    ["image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")],
    ["audio/wav", bytes("RIFF", 0, 0, 0, 0, "WAVEfmt ")],
    ["audio/ogg", bytes("OggS", 0)],
    ["audio/webm", bytes(0x1a, 0x45, 0xdf, 0xa3)],
    ["audio/mpeg", bytes("ID3", 4, 0)],
    ["audio/mpeg", bytes(0xff, 0xfb, 0x90, 0x64)],
    ["audio/aac", bytes(0xff, 0xf1, 0x50, 0x80)],
    ["audio/mp4", bytes(0, 0, 0, 0x1c, "ftypM4A ")],
    ["audio/mp4", bytes(0, 0, 0, 0x20, "ftypisom")],
  ])("recognises %s", (type, head) => {
    expect(sniffCardMediaType(head)).toBe(type);
  });

  it("ignores text, HEIC, and short heads", () => {
    expect(sniffCardMediaType(bytes("hello world"))).toBeNull();
    expect(sniffCardMediaType(bytes(0, 0, 0, 0x18, "ftypheic"))).toBeNull();
    expect(sniffCardMediaType(bytes(0xff, 0xd8))).toBeNull();
  });
});

describe("resolveCardMediaType", () => {
  const m4a = bytes(0, 0, 0, 0x1c, "ftypM4A ");

  it("trusts a declared type, without parameters", () => {
    expect(resolveCardMediaType("audio/webm;codecs=opus", "clip.webm", m4a)).toBe("audio/webm");
    expect(resolveCardMediaType("IMAGE/PNG", "a.png", bytes())).toBe("image/png");
  });

  it.each(["", "application/octet-stream", "text/plain", "text/plain;charset=UTF-8"])(
    "identifies an untyped (%j) part by its bytes, then its name",
    (declared) => {
      expect(resolveCardMediaType(declared, "recording.bin", m4a)).toBe("audio/mp4");
      expect(resolveCardMediaType(declared, "Clip.M4A", bytes(1, 2, 3, 4))).toBe("audio/mp4");
      expect(resolveCardMediaType(declared, "photo.jpeg", bytes(1, 2, 3, 4))).toBe("image/jpeg");
    },
  );

  it("leaves an unrecognisable untyped part as it came", () => {
    expect(resolveCardMediaType("text/plain", "notes.txt", bytes("notes"))).toBe("text/plain");
    expect(resolveCardMediaType("", "noname", bytes("x"))).toBe("");
  });
});
