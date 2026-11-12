import { describe, expect, it } from "vitest";

import { mediaTypeForName, typedAudioBlob, typedImageUpload } from "../lib/upload-media";

// expo/fetch reads file:// URIs into blobs with no type.
const untyped = () => new Blob([new Uint8Array([1, 2, 3, 4])]);

describe("typedAudioBlob", () => {
  it("labels a recording by its file name", async () => {
    const blob = typedAudioBlob(untyped(), "recording-1762905600000.m4a");
    expect(blob.type).toBe("audio/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("prefers the picker's audio type, then the name", () => {
    expect(typedAudioBlob(untyped(), "lecture.mp3", "audio/x-m4a").type).toBe("audio/x-m4a");
    expect(typedAudioBlob(untyped(), "lecture.mp3", "application/octet-stream").type).toBe("audio/mpeg");
  });

  it("keeps a blob that already has a real type", () => {
    const typed = new Blob([new Uint8Array(4)], { type: "audio/ogg" });
    expect(typedAudioBlob(typed, "clip.m4a")).toBe(typed);
  });

  it("leaves an unknown file untyped for the server to reject", () => {
    expect(typedAudioBlob(untyped(), "notes.txt").type).toBe("");
  });
});

describe("typedImageUpload", () => {
  it("names a re-encoded HEIC photo as the JPEG it now is", () => {
    const { blob, filename, baseName } = typedImageUpload(untyped(), { fileName: "IMG_0042.HEIC", mimeType: "image/heic" });
    expect(blob.type).toBe("image/jpeg");
    expect(filename).toBe("IMG_0042.jpg");
    expect(baseName).toBe("IMG_0042");
  });

  it("uses the picker's type and a matching extension", () => {
    const { blob, filename } = typedImageUpload(untyped(), { fileName: "diagram.PNG", mimeType: "image/png" });
    expect(blob.type).toBe("image/png");
    expect(filename).toBe("diagram.png");
  });

  it("falls back to a JPEG named image", () => {
    const { blob, filename } = typedImageUpload(untyped(), {});
    expect(blob.type).toBe("image/jpeg");
    expect(filename).toBe("image.jpg");
  });
});

describe("mediaTypeForName", () => {
  it("maps card media extensions case-insensitively", () => {
    expect(mediaTypeForName("a.M4A")).toBe("audio/mp4");
    expect(mediaTypeForName("a.wav")).toBe("audio/wav");
    expect(mediaTypeForName("a.webp")).toBe("image/webp");
    expect(mediaTypeForName("a.heic")).toBe("");
  });
});
