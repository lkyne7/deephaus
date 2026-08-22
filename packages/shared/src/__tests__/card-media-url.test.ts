import { describe, expect, it } from "vitest";
import { isSupabaseCardMediaUrl } from "../card-media-url.js";

const SUPABASE_URL = "https://project-ref.supabase.co";

describe("isSupabaseCardMediaUrl", () => {
  it("accepts card-media object and render URLs from the configured Supabase origin", () => {
    expect(
      isSupabaseCardMediaUrl(
        "https://project-ref.supabase.co/storage/v1/object/public/card-media/user/card.png",
        SUPABASE_URL,
      ),
    ).toBe(true);
    expect(
      isSupabaseCardMediaUrl(
        "https://project-ref.supabase.co/storage/v1/render/image/public/card-media/user/card.png?width=960",
        `${SUPABASE_URL}/`,
      ),
    ).toBe(true);
  });

  it("rejects Supabase-shaped card-media URLs from other hosts when an origin is configured", () => {
    expect(
      isSupabaseCardMediaUrl(
        "http://169.254.169.254/storage/v1/object/public/card-media/latest/meta-data",
        SUPABASE_URL,
      ),
    ).toBe(false);
    expect(
      isSupabaseCardMediaUrl(
        "https://evil.example/storage/v1/render/image/public/card-media/user/card.png?width=960",
        SUPABASE_URL,
      ),
    ).toBe(false);
  });

  it("keeps legacy card-media detection for callers without an origin", () => {
    expect(
      isSupabaseCardMediaUrl(
        "https://any-supabase-host.example/storage/v1/object/public/card-media/user/card.png",
      ),
    ).toBe(true);
    expect(isSupabaseCardMediaUrl("https://example.com/image.png")).toBe(false);
  });
});
