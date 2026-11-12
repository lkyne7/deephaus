import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { POST } from "@/app/api/cards/[id]/media/route";

const CARD_ID = "22222222-2222-4222-8222-222222222222";
const M4A = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]); // "ftypM4A "
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function call(request: Request) {
  return POST(request, { params: Promise.resolve({ id: CARD_ID }) });
}

function browserUpload(file: File) {
  const form = new FormData();
  form.append("file", file);
  return call(new Request(`https://app.test/api/cards/${CARD_ID}/media`, { method: "POST", body: form }));
}

// The phone (apps/mobile/components/card-editor/card-field-editor.tsx) reads the
// clip with fetch(file://…).blob(), which under expo/fetch has no type, so expo's
// multipart encoder (expo/src/winter/fetch/convertFormData.ts) writes the part
// with a filename and no Content-Type. The parser then reports text/plain.
function phoneUpload(filename: string, bytes: Uint8Array) {
  const boundary = "----ExpoFetchFormBoundaryAbCdEfGh12345678";
  const head = `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = new Uint8Array([...new TextEncoder().encode(head), ...bytes, ...new TextEncoder().encode(tail)]);
  return call(
    new Request(`https://app.test/api/cards/${CARD_ID}/media`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "user-agent": "DeepHaus/21 CFNetwork/3896.200.61 Darwin/27.2.0",
      },
      body,
    }),
  );
}

describe("POST /api/cards/[id]/media", () => {
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const single = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    upload.mockResolvedValue({ error: null });
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://cdn.test/card-media/${path}` } }));
    single.mockResolvedValue({ data: { id: CARD_ID } });
    const query = { select: () => query, eq: () => query, single };
    createClient.mockResolvedValue({
      from: () => query,
      storage: { from: () => ({ upload, getPublicUrl }) },
    });
  });

  it("stores a browser upload under its declared type", async () => {
    const response = await browserUpload(new File([M4A], "clip.webm", { type: "audio/webm;codecs=opus" }));
    expect(response.status).toBe(201);
    expect((await response.json()).kind).toBe("audio");
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "audio/webm" });
  });

  it("accepts the phone's recording, sent with no part Content-Type", async () => {
    const response = await phoneUpload("recording-1762905600000.m4a", M4A);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.kind).toBe("audio");
    expect(body.path).toMatch(/^user-1\/22222222-2222-4222-8222-222222222222\/\d+-recording-1762905600000\.m4a$/);
    const [path, buffer, options] = upload.mock.calls[0];
    expect(path).toBe(body.path);
    expect(Buffer.from(buffer).subarray(4, 12).toString("latin1")).toBe("ftypM4A ");
    expect(options).toMatchObject({ contentType: "audio/mp4" });
  });

  it("falls back to the file name when the bytes aren't recognised", async () => {
    const response = await phoneUpload("lecture.mp3", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(response.status).toBe(201);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "audio/mpeg" });
  });

  it("identifies a re-encoded photo that kept its .HEIC name by its bytes", async () => {
    const response = await phoneUpload("IMG_0042.HEIC", JPEG);
    expect(response.status).toBe(201);
    expect((await response.json()).kind).toBe("image");
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/jpeg" });
  });

  it("still rejects an untyped part that isn't media", async () => {
    const response = await phoneUpload("notes.txt", new TextEncoder().encode("just some notes"));
    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an untyped audio clip over the size limit", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(M4A);
    const response = await phoneUpload("long.m4a", big);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Audio clips can be up to 4 MB/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns 404 for a card the user doesn't own", async () => {
    single.mockResolvedValue({ data: null });
    const response = await phoneUpload("recording.m4a", M4A);
    expect(response.status).toBe(404);
    expect(upload).not.toHaveBeenCalled();
  });
});
