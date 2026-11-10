import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/send", () => ({
  deliverReminder: vi.fn(async (device: { platform: string; subscription: unknown }) =>
    device.platform === "desktop" ? "queued" : device.subscription === "dead" ? "gone" : "sent",
  ),
}));
// The exam service reaches for server-only modules that a unit test has no use for.
vi.mock("@/lib/exams/service", () => ({ getExamDetail: vi.fn(), listExams: vi.fn() }));

import { reminderPath, sendReminder } from "@/lib/notifications/dispatch";
import type { DeviceRow } from "@/lib/notifications/prefs";

const device = (id: string, platform: DeviceRow["platform"], subscription: unknown = {}): DeviceRow => ({
  id,
  user_id: "user",
  platform,
  token: `token-${id}`,
  subscription,
  label: null,
  enabled: true,
  last_seen_at: "2026-11-09T12:00:00Z",
});

const reminder = {
  kind: "daily_reviews" as const,
  examId: null,
  dedupeKey: "daily_reviews:2026-11-09",
  title: "32 cards due",
  body: "About 11 min.",
};

/** A stand-in for the service client that records what was written. */
function fakeService(insertResult: { data: { id: string } | null; error: { code: string; message: string } | null }) {
  const inserted: unknown[] = [];
  const deleted: string[][] = [];
  const service = {
    from(table: string) {
      if (table === "notification_log") {
        return {
          insert(row: unknown) {
            inserted.push(row);
            return { select: () => ({ single: async () => insertResult }) };
          },
        };
      }
      return {
        delete: () => ({
          in: async (_column: string, ids: string[]) => {
            deleted.push(ids);
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { service, inserted, deleted };
}

describe("reminderPath", () => {
  it("opens the exam's session, or the combined session", () => {
    expect(reminderPath({ target: { type: "exam", id: "e1" } })).toBe("/exams/e1/study");
    expect(reminderPath({ target: { type: "study" } })).toBe("/review");
  });
});

describe("sendReminder", () => {
  it("records the reminder, delivers it everywhere, and forgets dead subscriptions", async () => {
    const { service, inserted, deleted } = fakeService({ data: { id: "log-1" }, error: null });
    const result = await sendReminder(
      service,
      "user",
      reminder,
      "/review",
      [device("a", "web"), device("b", "web", "dead"), device("c", "desktop")],
      null,
    );
    expect(inserted).toEqual([
      {
        user_id: "user",
        kind: "daily_reviews",
        exam_id: null,
        dedupe_key: "daily_reviews:2026-11-09",
        title: "32 cards due",
        body: "About 11 min.",
        path: "/review",
      },
    ]);
    expect(result).toEqual({
      recorded: true,
      id: "log-1",
      deliveries: [
        { deviceId: "a", platform: "web", result: "sent" },
        { deviceId: "b", platform: "web", result: "gone" },
        { deviceId: "c", platform: "desktop", result: "queued" },
      ],
    });
    expect(deleted).toEqual([["b"]]);
  });

  it("keeps a device registered moments ago even when the push service calls it gone", async () => {
    const { service, deleted } = fakeService({ data: { id: "log-2" }, error: null });
    const fresh = { ...device("new", "web", "dead"), last_seen_at: new Date(Date.now() - 3_000).toISOString() };
    const result = await sendReminder(service, "user", reminder, "/review", [fresh, device("old", "web", "dead")], null);
    // Both are reported as not reached; only the settled one is forgotten.
    expect(result.deliveries.map((delivery) => delivery.result)).toEqual(["gone", "gone"]);
    expect(deleted).toEqual([["old"]]);
  });

  it("sends nothing when this occasion was already recorded", async () => {
    const { service, deleted } = fakeService({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const result = await sendReminder(service, "user", reminder, "/review", [device("a", "web")], null);
    expect(result).toEqual({ recorded: false, id: null, deliveries: [] });
    expect(deleted).toEqual([]);
  });

  it("surfaces any other failure to record", async () => {
    const { service } = fakeService({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(
      sendReminder(service, "user", reminder, "/review", [device("a", "web")], null),
    ).rejects.toThrow("permission denied");
  });
});
