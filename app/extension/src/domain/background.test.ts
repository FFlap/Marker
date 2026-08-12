import { describe, expect, it, vi } from "vitest";
import { classifyDeliveryError, createMessageHandler } from "./background";
import { SYNC_OUTBOX_KEY } from "./sync";

const payload = {
  service: "netflix" as const,
  seriesTitle: "Dark",
  seasonNumber: 1,
  episodeNumber: 2,
};
const token = "t".repeat(64);
const setup = () => {
  const values: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async () => ({ ...values })),
    set: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(values, next);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
  const client = {
    getSession: vi.fn(
      async (): Promise<{ token: string; accountLabel: string } | null> => ({
        token,
        accountLabel: "@viewer",
      }),
    ),
    connect: vi.fn(),
    signOut: vi.fn(),
    record: vi.fn(),
  };
  return {
    values,
    storage,
    client,
    background: createMessageHandler(storage, client),
  };
};

describe("background delivery classification", () => {
  it.each([
    [{ data: { code: "upstream" } }, "retryable"],
    [new TypeError("Failed to fetch"), "retryable"],
    [
      Object.assign(new Error("timed out"), { name: "AbortError" }),
      "retryable",
    ],
    [{ status: 401 }, "auth"],
    [{ status: 503 }, "retryable"],
    [{ data: { code: "validation" } }, "terminal"],
    [new Error("server exploded"), "terminal"],
  ] as const)("classifies %o as %s", (error, expected) =>
    expect(classifyDeliveryError(error)).toBe(expected),
  );

  it("serializes classified results before returning them across messaging", async () => {
    const x = setup();
    x.client.record.mockRejectedValue({ data: { code: "validation" } });
    await expect(x.background.deliver(payload)).resolves.toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
    });
    expect(x.values["sync.lastResult"]).toMatchObject({
      ok: false,
      reason: "rejected",
    });
  });
  it("preserves server error data and classifies upstream failures as retryable", async () => {
    const x = setup();
    const error = Object.assign(new Error("upstream"), {
      data: { code: "upstream" },
    });
    x.client.record.mockRejectedValue(error);
    await expect(x.background.deliver(payload)).resolves.toMatchObject({
      retryable: true,
    });
    expect(error.data.code).toBe("upstream");
  });
  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "sync/signIn", email: "a@b.com" },
  ])("returns a terminal error for malformed messages", async (message) => {
    await expect(setup().background.handler(message)).resolves.toEqual({
      ok: false,
      reason: "invalid-message",
      retryable: false,
    });
  });
  it("returns a structured response when website connection fails", async () => {
    const x = setup();
    x.client.connect.mockRejectedValue(new Error("Connection cancelled"));
    await expect(
      x.background.handler({ type: "sync/connect" }),
    ).resolves.toEqual({ signedIn: false, reason: "Connection cancelled" });
  });
  it("auth failure pauses the queued event and later flushes skip delivery without a Clerk session", async () => {
    const x = setup();
    x.client.record.mockRejectedValue({ status: 401 });
    await x.background.handler({ type: "sync/enqueue", payload });
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([payload]);
    x.client.getSession.mockResolvedValue(null);
    x.client.record.mockClear();
    await x.background.handler({ type: "sync/flushNow" });
    expect(x.client.record).not.toHaveBeenCalled();
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([payload]);
  });
  it("dequeues malformed server failures as rejected", async () => {
    const x = setup();
    x.client.record.mockRejectedValue(new Error("bad response"));
    await x.background.handler({ type: "sync/enqueue", payload });
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([]);
    expect(x.values["sync.lastResult"]).toMatchObject({ reason: "rejected" });
  });
});
