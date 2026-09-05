import { describe, expect, it, vi } from "vitest";
import { classifyDeliveryError, createMessageHandler } from "./background";
import { SYNC_OUTBOX_KEY } from "./sync";
import { normalizeBookmarkStore } from "./bookmarks";
import { BOOKMARKS_STORAGE_KEY } from "../messages";

const payload = {
  service: "netflix" as const,
  seriesTitle: "Dark",
  seasonNumber: 1,
  episodeNumber: 2,
};
const token = "t".repeat(64);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
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
      async (): Promise<{ token: string; accountId: string; accountLabel: string } | null> => ({
        token,
        accountId: "viewer",
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
    await expect(x.background.deliver(payload, "viewer")).resolves.toEqual({
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
    await expect(x.background.deliver(payload, "viewer")).resolves.toMatchObject({
      retryable: true,
    });
    expect(error.data.code).toBe("upstream");
  });
});

describe("background message validation", () => {
  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "sync/signIn", email: "a@b.com" },
  ])("returns a terminal error for malformed message %o", async (message) => {
    await expect(setup().background.handler(message)).resolves.toEqual({
      ok: false,
      reason: "invalid-message",
      retryable: false,
    });
  });
});

describe("background sign-out cleanup", () => {
  it("clears queued watch data and retry state when signing out", async () => {
    const x = setup();
    x.values["sync.outbox"] = [payload];
    x.values["sync.outboxRetry"] = { attempt: 1, nextRetryAt: 1000 };
    x.values["sync.lastResult"] = {
      ok: false,
      at: 1,
      seriesTitle: "Dark",
    };
    const alarms = { schedule: vi.fn(), clear: vi.fn() };
    const background = createMessageHandler(x.storage, x.client, { alarms });

    await expect(background.handler({ type: "sync/signOut" })).resolves.toEqual({
      signedIn: false,
    });
    expect(x.values["sync.outbox"]).toBeUndefined();
    expect(x.values["sync.outboxRetry"]).toBeUndefined();
    expect(x.values["sync.lastResult"]).toBeUndefined();
    expect(alarms.clear).toHaveBeenCalledWith("sync.outboxRetry");
  });
  it("keeps the outbox cleared when sign-out waits for an in-flight flush", async () => {
    const x = setup();
    const gate = deferred<unknown>();
    x.client.record.mockReturnValue(gate.promise);

    const enqueue = x.background.handler({ type: "sync/enqueue", payload });
    await vi.waitFor(() => expect(x.client.record).toHaveBeenCalledOnce());
    const signOut = x.background.handler({ type: "sync/signOut" });
    gate.resolve({ ok: true });
    await Promise.all([enqueue, signOut]);

    expect(x.values[SYNC_OUTBOX_KEY]).toBeUndefined();
  });
});

describe("background bookmark serialization", () => {
  it("serializes bookmark saves and removals through one background queue", async () => {
    const x = setup();
    const first = {
      platform: "netflix" as const,
      seriesId: "first",
      seriesTitle: "First",
      seriesUrl: "https://www.netflix.com/title/first",
      seasonNumber: "1",
      episodeNumber: "1",
      episodeTitle: "Pilot",
      episodeId: "first-1",
      watchUrl: "https://www.netflix.com/watch/first-1",
      updatedAt: 1,
    };
    const second = {
      ...first,
      seriesId: "second",
      seriesTitle: "Second",
      episodeId: "second-1",
      seriesUrl: "https://www.netflix.com/title/second",
      watchUrl: "https://www.netflix.com/watch/second-1",
    };
    x.values[BOOKMARKS_STORAGE_KEY] = {
      version: 1,
      bookmarks: { "netflix:first": first },
    };

    await Promise.all([
      x.background.handler({ type: "bookmark/remove", key: "netflix:first" }),
      x.background.handler({ type: "bookmark/save", bookmark: second }),
    ]);

    expect(
      normalizeBookmarkStore(x.values[BOOKMARKS_STORAGE_KEY]).bookmarks,
    ).toEqual({ "netflix:second": second });
  });
});

describe("background website connection", () => {
  it("returns a structured response when website connection fails", async () => {
    const x = setup();
    x.client.connect.mockRejectedValue(new Error("Connection cancelled"));
    await expect(
      x.background.handler({ type: "sync/connect" }),
    ).resolves.toEqual({ signedIn: false, reason: "Connection cancelled" });
  });
});

describe("background queue behavior", () => {
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
  it("refreshes the retry schedule when an alarm fires without a session", async () => {
    const x = setup();
    x.values[SYNC_OUTBOX_KEY] = [payload];
    x.values["sync.outboxRetry"] = { attempt: 1, nextRetryAt: 1_000 };
    x.client.getSession.mockResolvedValue(null);
    const alarms = { schedule: vi.fn(), clear: vi.fn() };
    const background = createMessageHandler(x.storage, x.client, {
      now: () => 1_000,
      alarms,
    });

    await expect(background.alarmFired()).resolves.toBe(false);
    expect(alarms.schedule).toHaveBeenCalledWith(
      "sync.outboxRetry",
      301_000,
    );
  });
});

describe("outbox account ownership", () => {
  it("never sends a previous account's queued history after a worker restart", async () => {
    const x = setup();
    x.client.record.mockRejectedValue({ status: 503 });
    await x.background.handler({ type: "sync/enqueue", payload });
    x.client.getSession.mockResolvedValue({ token: "other-token", accountId: "other", accountLabel: "Other" });
    x.client.record.mockClear();
    const restarted = createMessageHandler(x.storage, x.client);
    await restarted.flush();
    expect(x.client.record).not.toHaveBeenCalled();
    expect(x.values[SYNC_OUTBOX_KEY]).toBeUndefined();
    await restarted.handler({ type: "sync/enqueue", payload: { ...payload, episodeNumber: 3 } });
    expect(x.client.record).toHaveBeenCalledWith("other-token", { ...payload, episodeNumber: 3 });
  });

  it("stops an in-flight batch if the account switches between deliveries", async () => {
    const x = setup();
    x.values[SYNC_OUTBOX_KEY] = [payload, { ...payload, episodeNumber: 3 }];
    x.client.record.mockImplementation(async () => {
      x.client.getSession.mockResolvedValue({ token: "other-token", accountId: "other", accountLabel: "Other" });
      return { ok: true };
    });
    await x.background.flush();
    expect(x.client.record).toHaveBeenCalledOnce();
    await x.background.flush();
    expect(x.client.record).toHaveBeenCalledOnce();
    expect(x.values[SYNC_OUTBOX_KEY]).toBeUndefined();
  });
});

const trackedBookmark = {
  platform: 'netflix' as const,
  seriesId: 'dark',
  seriesTitle: 'Dark',
  seriesUrl: 'https://www.netflix.com/title/dark',
  seasonNumber: '1',
  episodeNumber: '2',
  episodeTitle: 'Lies',
  episodeId: 'dark-2',
  watchUrl: 'https://www.netflix.com/watch/dark-2',
  updatedAt: 1,
};

it('durably queues an unchanged bookmark after its first enqueue failed', async () => {
  const x = setup();
  x.client.getSession.mockResolvedValue(null);
  let failOnce = true;
  x.storage.set.mockImplementation(async (items) => {
    if (SYNC_OUTBOX_KEY in items && failOnce) {
      failOnce = false;
      throw new Error('Storage unavailable');
    }
    Object.assign(x.values, items);
  });
  const message = { type: 'bookmark/save', bookmark: trackedBookmark };
  await expect(x.background.handler(message)).rejects.toThrow('Storage unavailable');
  expect(normalizeBookmarkStore(x.values[BOOKMARKS_STORAGE_KEY]).bookmarks['netflix:dark']).toBeDefined();
  await expect(x.background.handler(message)).resolves.toEqual({ changed: false });
  expect(x.values[SYNC_OUTBOX_KEY]).toMatchObject([{ seriesTitle: 'Dark', episodeNumber: 2 }]);
  expect(x.values['sync.outboxRetry']).toBeDefined();
});

it('acknowledges and preserves new saves while a previous delivery is in flight', async () => {
  const x = setup();
  const gate = deferred<unknown>();
  x.client.record.mockReturnValue(gate.promise);
  await x.background.handler({ type: 'bookmark/save', bookmark: trackedBookmark });
  await vi.waitFor(() => expect(x.client.record).toHaveBeenCalledOnce());
  const inFlight = x.background.flush();
  await expect(x.background.handler({ type: 'bookmark/save', bookmark: {
    ...trackedBookmark, episodeNumber: '3', episodeId: 'dark-3', episodeTitle: 'Past and Present',
  } })).resolves.toEqual({ changed: true });
  expect(x.values[SYNC_OUTBOX_KEY]).toHaveLength(2);
  gate.resolve({ ok: true });
  await inFlight;
  expect(x.values[SYNC_OUTBOX_KEY]).toMatchObject([{ episodeNumber: 3 }]);
  expect(x.values['sync.outboxRetry']).toMatchObject({ nextRetryAt: expect.any(Number) });
});

it('keeps the new account queue when an old account delivery finishes', async () => {
  const x = setup();
  x.values[SYNC_OUTBOX_KEY] = [{ ...payload, episodeNumber: 1 }, payload];
  x.values['sync.accountId'] = 'viewer';
  const gate = deferred<unknown>();
  x.client.record.mockReturnValue(gate.promise);
  const inFlight = x.background.flush();
  await vi.waitFor(() => expect(x.client.record).toHaveBeenCalledOnce());
  x.client.getSession.mockResolvedValue({ token: 'other-token', accountId: 'other', accountLabel: 'Other' });
  await x.background.handler({ type: 'bookmark/save', bookmark: trackedBookmark });
  gate.resolve({ ok: true });
  await inFlight;
  expect(x.client.record).toHaveBeenCalledOnce();
  expect(x.client.record).toHaveBeenCalledWith(token, expect.any(Object));
  expect(x.values[SYNC_OUTBOX_KEY]).toMatchObject([{ seriesTitle: 'Dark', episodeNumber: 2 }]);
  expect(x.values['sync.accountId']).toBe('other');
  expect(x.values['sync.lastResult']).toBeUndefined();
});

it('waits to bind an unowned batch when sign-in finishes after its snapshot', async () => {
  const x = setup();
  x.values[SYNC_OUTBOX_KEY] = [payload];
  x.client.getSession.mockResolvedValueOnce(null);
  x.client.record.mockResolvedValue({ ok: true });

  await x.background.flush();
  expect(x.client.record).not.toHaveBeenCalled();
  expect(x.values[SYNC_OUTBOX_KEY]).toEqual([payload]);
  expect(x.values['sync.accountId']).toBeUndefined();

  await x.background.flush();
  expect(x.client.record).toHaveBeenCalledExactlyOnceWith(token, payload);
  expect(x.values['sync.accountId']).toBe('viewer');
  expect(x.values[SYNC_OUTBOX_KEY]).toEqual([]);
});
