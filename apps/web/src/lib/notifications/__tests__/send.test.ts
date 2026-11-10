import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterEach, describe, expect, it, vi } from "vitest";
import { vapidConfig } from "@/lib/notifications/config";
import { deliverReminder } from "@/lib/notifications/send";

const payload = { id: "r1", title: "32 cards due", body: "About 11 min.", path: "/review" };

function browserSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: "https://push.example.test/send/abc123",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

const keys = webpush.generateVAPIDKeys();
const vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:test@example.test" };

afterEach(() => vi.restoreAllMocks());

describe("vapidConfig", () => {
  it("is off unless both halves of the key are set", () => {
    expect(vapidConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(vapidConfig({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      vapidConfig({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:support@deephaus.ai" });
  });
});

describe("deliverReminder", () => {
  it("builds a signed, encrypted request a push service accepts", () => {
    // What deliverReminder hands to web-push, checked without a network call.
    const details = webpush.generateRequestDetails(browserSubscription(), JSON.stringify(payload), {
      TTL: 3600,
      vapidDetails: vapid,
    });
    expect(details.endpoint).toBe("https://push.example.test/send/abc123");
    expect(details.method).toBe("POST");
    expect(details.headers.TTL).toBe(3600);
    expect(details.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(details.headers.Authorization)).toMatch(/^vapid t=.+, k=.+/);
    // The body is ciphertext, not the reminder in the clear.
    expect(details.body?.toString("utf8")).not.toContain("32 cards due");
  });

  it("sends to a browser and reports what the push service said", async () => {
    const send = vi.spyOn(webpush, "sendNotification");
    const device = { platform: "web" as const, subscription: browserSubscription() };

    send.mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });
    expect(await deliverReminder(device, payload, vapid)).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      device.subscription,
      JSON.stringify(payload),
      expect.objectContaining({ TTL: 3600, vapidDetails: vapid }),
    );

    // The browser unsubscribed or the subscription expired.
    send.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    expect(await deliverReminder(device, payload, vapid)).toBe("gone");
    send.mockRejectedValueOnce(Object.assign(new Error("Not found"), { statusCode: 404 }));
    expect(await deliverReminder(device, payload, vapid)).toBe("gone");
    // A push service having a bad minute is not a dead device.
    send.mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { statusCode: 503 }));
    expect(await deliverReminder(device, payload, vapid)).toBe("failed");
  });

  it("logs what the push service said, but never the endpoint", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(webpush, "sendNotification").mockRejectedValueOnce(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );
    await deliverReminder({ platform: "web", subscription: browserSubscription() }, payload, vapid);
    expect(warn).toHaveBeenCalledWith("[reminders] push not accepted", {
      status: 410,
      service: "push.example.test",
    });
    // Whoever holds the endpoint can push to that browser.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("abc123");
  });

  it("does not try what it cannot do", async () => {
    const send = vi.spyOn(webpush, "sendNotification");
    expect(await deliverReminder({ platform: "desktop", subscription: null }, payload, vapid)).toBe("queued");
    expect(await deliverReminder({ platform: "ios", subscription: null }, payload, vapid)).toBe("unsupported");
    expect(
      await deliverReminder({ platform: "web", subscription: browserSubscription() }, payload, null),
    ).toBe("unsupported");
    expect(await deliverReminder({ platform: "web", subscription: { endpoint: "x" } }, payload, vapid)).toBe("gone");
    expect(send).not.toHaveBeenCalled();
  });
});
