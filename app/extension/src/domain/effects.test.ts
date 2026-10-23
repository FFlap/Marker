import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { external, runExtension, ExtensionFailure } from "./effects";
import { createMessageHandler, type AuthClient } from "./background";
import { createBookmarkOperations } from "./bookmarks";
import { createWatchTransport, createWatchTransportEffect } from "./http";
import { createContentLifetime } from "./lifecycle";
import { createOutboxManager, SYNC_OUTBOX_KEY, SYNC_RETRY_KEY } from "./sync";

const payload = {
  service: "netflix" as const,
  seriesTitle: "Dark",
  seasonNumber: 1,
  episodeNumber: 2,
};

describe("Effect extension boundaries", () => {
  it("preserves original external errors and programming defects at Promise edges", async () => {
    const error = new Error("storage unavailable");
    await expect(
      runExtension(external("storage.get", () => Promise.reject(error))),
    ).rejects.toBe(error);
    const defect = new TypeError("programming defect");
    await expect(
      runExtension(
        Effect.sync(() => {
          throw defect;
        }),
      ),
    ).rejects.toBe(defect);
  });

  it("releases the bookmark queue after storage failure", async () => {
    const error = new Error("read failed");
    const storage = {
      get: vi.fn().mockRejectedValueOnce(error).mockResolvedValue({}),
      set: vi.fn(async () => undefined),
    };
    const bookmarks = createBookmarkOperations(storage, "bookmarks");
    const failed = bookmarks.clear();
    const next = bookmarks.clear();
    await expect(failed).rejects.toBe(error);
    await expect(next).resolves.toBeUndefined();
    expect(storage.set).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight fetch when its Effect is interrupted", async () => {
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn<typeof fetch>((_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const post = createWatchTransport("https://example.com/watch", request);
    const result = post("private-token", payload, controller.signal);
    const rejected = expect(result).rejects.toBeDefined();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("times out body decoding and releases the network resource", async () => {
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return {
        status: 200,
        arrayBuffer: () => new Promise(() => {}),
      } as unknown as Response;
    });
    await expect(
      createWatchTransport(
        "https://example.com/watch",
        request,
        10,
      )("token", payload),
    ).rejects.toMatchObject({ status: 408 });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("treats malformed successful HTTP responses as retryable upstream failures", async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: "yes" })),
    );
    await expect(
      createWatchTransport("https://example.com/watch", request)(
        "token",
        payload,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("posts once without CORS trace headers and releases the request after decoding", async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-token");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.has("b3")).toBe(false);
      expect(headers.has("traceparent")).toBe(false);
      expect(init?.method).toBe("POST");
      expect(
        JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)),
      ).toEqual(payload);
      return new Response(JSON.stringify({ ok: true, unverified: true }));
    });
    await expect(
      createWatchTransport("https://example.com/watch", request)(
        "test-token",
        payload,
      ),
    ).resolves.toEqual({ ok: true, unverified: true });
    expect(request).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    undefined,
    null,
    "offline",
    { arbitrary: true },
    new TypeError("offline"),
  ])("preserves an unknown fetch rejection unchanged: %s", async (failure) => {
    const request = vi.fn<typeof fetch>(() => Promise.reject(failure));
    await expect(
      createWatchTransport("https://example.com/watch", request)(
        "token",
        payload,
      ),
    ).rejects.toBe(failure);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([401, 429, 503])(
    "preserves HTTP status %s without retrying a POST",
    async (status) => {
      const request = vi.fn<typeof fetch>(
        async () => new Response("failed", { status }),
      );
      await expect(
        createWatchTransport("https://example.com/watch", request)(
          "token",
          payload,
        ),
      ).rejects.toMatchObject({ status });
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("closes content scopes once, aborting pending work and removing listeners", () => {
    let invalidate!: () => void;
    const lifetime = createContentLifetime((dispose) => {
      invalidate = dispose;
    });
    const listener = vi.fn();
    const release = vi.fn();
    lifetime.listen(window, "marker-test", listener);
    lifetime.own(release);
    window.dispatchEvent(new Event("marker-test"));
    invalidate();
    invalidate();
    window.dispatchEvent(new Event("marker-test"));
    expect(listener).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(lifetime.signal.aborted).toBe(true);
  });

  it("keeps concurrent enqueue operations bounded and restores retry state after invalid persistence", async () => {
    const values: Record<string, unknown> = {
      [SYNC_RETRY_KEY]: { attempt: NaN, nextRetryAt: Infinity },
    };
    const storage = {
      get: async () => ({ ...values }),
      set: async (next: Record<string, unknown>) => {
        Object.assign(values, next);
      },
    };
    const schedule = vi.fn();
    const outbox = createOutboxManager(
      storage,
      async () => ({ ok: false, retryable: true }),
      { now: () => 100, alarms: { schedule, clear: vi.fn() } },
    );
    await Promise.all(
      Array.from({ length: 25 }, (_, episodeNumber) =>
        outbox.enqueue({ ...payload, episodeNumber }),
      ),
    );
    expect(values[SYNC_OUTBOX_KEY]).toHaveLength(20);
    expect(
      (values[SYNC_OUTBOX_KEY] as Array<{ episodeNumber: number }>).map(
        (entry) => entry.episodeNumber,
      ),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 5));
    values[SYNC_RETRY_KEY] = { attempt: NaN, nextRetryAt: Infinity };
    await outbox.flush();
    expect(values[SYNC_RETRY_KEY]).toEqual({ attempt: 1, nextRetryAt: 60_100 });
    expect(schedule).toHaveBeenLastCalledWith("sync.outboxRetry", 60_100);
  });
});

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const bookmark = {
  platform: "netflix" as const,
  seriesId: "dark",
  seriesTitle: "Dark",
  seriesUrl: "https://www.netflix.com/title/dark",
  seasonNumber: "1",
  episodeNumber: "2",
  episodeTitle: "Lies",
  episodeId: "dark-2",
  watchUrl: "https://www.netflix.com/watch/dark-2",
  updatedAt: 100,
};
function blockedStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  const gate = deferred<void>();
  let first = true;
  const writes: Record<string, unknown>[] = [];
  return {
    values,
    gate,
    writes,
    storage: {
      get: async () => {
        if (first) {
          first = false;
          await gate.promise;
        }
        return { ...values };
      },
      set: async (items: Record<string, unknown>) => {
        writes.push(items);
        Object.assign(values, items);
      },
      remove: async (key: string) => {
        delete values[key];
      },
    },
  };
}

it("preserves bookmark FIFO when clear arrives before a queued save resumes", async () => {
  const x = blockedStorage();
  const manager = createBookmarkOperations(x.storage, "bookmarks");
  const first = manager.save(bookmark);
  const second = manager.save({
    ...bookmark,
    episodeId: "dark-3",
    episodeNumber: "3",
  });
  x.gate.resolve();
  await first;
  const clear = manager.clear();
  await Promise.all([second, clear]);
  expect(x.values.bookmarks).toEqual({ version: 1, bookmarks: {} });
  expect(
    x.writes.map(
      (entry) =>
        Object.values(
          (entry.bookmarks as { bookmarks: Record<string, typeof bookmark> })
            .bookmarks,
        )[0]?.episodeNumber,
    ),
  ).toEqual(["2", "3", undefined]);
});

it.each([false, true])(
  "preserves outbox FIFO across a fresh caller (clear queued: %s)",
  async (clearQueued) => {
    const x = blockedStorage();
    const manager = createOutboxManager(x.storage, async () => ({
      ok: true,
      retryable: false,
    }));
    const first = manager.enqueue(payload);
    const second = clearQueued
      ? manager.clear()
      : manager.enqueue({ ...payload, episodeNumber: 3 });
    x.gate.resolve();
    await first;
    const third = clearQueued
      ? manager.enqueue({ ...payload, episodeNumber: 3 })
      : manager.clear();
    await Promise.all([second, third]);
    if (clearQueued) {
      expect(x.values[SYNC_OUTBOX_KEY]).toEqual([
        { ...payload, episodeNumber: 3 },
      ]);
      expect(x.values[SYNC_RETRY_KEY]).toMatchObject({ attempt: 0 });
    } else {
      expect(x.values[SYNC_OUTBOX_KEY]).toBeUndefined();
      expect(x.values[SYNC_RETRY_KEY]).toBeUndefined();
    }
  },
);

it.each([false, true])(
  "retains undelivered events across full background composition (legacy Promise: %s)",
  async (legacy) => {
    const defect = new Error("programming defect");
    const x = blockedStorage({ [SYNC_OUTBOX_KEY]: [payload] });
    x.gate.resolve();
    const schedule = vi.fn();
    const record = vi.fn<AuthClient["record"]>(() =>
      legacy ? runExtension(Effect.die(defect)) : Effect.die(defect),
    );
    const background = createMessageHandler(
      x.storage,
      {
        getSession: () =>
          Effect.succeed({
            token: "test",
            accountId: "viewer",
            accountLabel: "Viewer",
          }),
        connect: () => Effect.void,
        signOut: () => Effect.void,
        record,
      },
      { now: () => 100, alarms: { schedule, clear: vi.fn() } },
    );
    if (legacy) await expect(background.flush()).resolves.toBe(false);
    else await expect(background.flush()).rejects.toBe(defect);
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([payload]);
    expect(x.values[SYNC_RETRY_KEY]).toEqual({
      attempt: 1,
      nextRetryAt: 60_100,
    });
    expect(x.values["sync.lastResult"]).not.toMatchObject({
      reason: "rejected",
    });
    expect(schedule).toHaveBeenCalledWith("sync.outboxRetry", 60_100);
    // A defect must release the single-flight cache so a later attempt can succeed.
    record.mockImplementation(() => Effect.succeed({ ok: true }));
    await expect(background.flush()).resolves.toBe(true);
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([]);
  },
);

it("bounds stalled auth preparation and fences its late result after sign-out", async () => {
  vi.useFakeTimers();
  try {
    const session = deferred<{
      token: string;
      accountId: string;
      accountLabel: string;
    }>();
    const x = blockedStorage({ [SYNC_OUTBOX_KEY]: [payload] });
    x.gate.resolve();
    const getSession = vi.fn(() => session.promise);
    const background = createMessageHandler(x.storage, {
      getSession,
      connect: async () => {},
      signOut: async () => {},
      record: async () => ({ ok: true }),
    });
    const flush = background.flush();
    const failed = expect(flush).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSession).toHaveBeenCalledOnce();
    const signOut = background.handler({ type: "sync/signOut" });
    await vi.advanceTimersByTimeAsync(15_001);
    await failed;
    await signOut;
    session.resolve({ token: "test", accountId: "old", accountLabel: "Old" });
    await vi.advanceTimersByTimeAsync(1);
    expect(x.values[SYNC_OUTBOX_KEY]).toBeUndefined();
    expect(x.values[SYNC_RETRY_KEY]).toBeUndefined();
    expect(x.values["sync.accountId"]).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("bounds delivery-time authentication and releases all shared flush callers for retry", async () => {
  vi.useFakeTimers();
  try {
    const identity = {
      token: "test",
      accountId: "viewer",
      accountLabel: "Viewer",
    };
    const lateSession = deferred<typeof identity>();
    const getSession = vi
      .fn<AuthClient["getSession"]>()
      .mockResolvedValueOnce(identity)
      .mockImplementationOnce(() => lateSession.promise)
      .mockResolvedValue(identity);
    const record = vi.fn<AuthClient["record"]>(async () => ({ ok: true }));
    const x = blockedStorage({ [SYNC_OUTBOX_KEY]: [payload] });
    x.gate.resolve();
    const schedule = vi.fn();
    const background = createMessageHandler(
      x.storage,
      {
        getSession,
        connect: async () => {},
        signOut: async () => {},
        record,
      },
      { now: () => 100, alarms: { schedule, clear: vi.fn() } },
    );
    const first = background.flush();
    const second = background.flush();
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(record).not.toHaveBeenCalled();
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([payload]);
    expect(schedule).toHaveBeenLastCalledWith("sync.outboxRetry", 60_100);
    lateSession.resolve(identity);
    await vi.advanceTimersByTimeAsync(1);
    expect(record).not.toHaveBeenCalled();
    await expect(background.flush()).resolves.toBe(true);
    expect(record).toHaveBeenCalledOnce();
    expect(x.values[SYNC_OUTBOX_KEY]).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("retains queued events and schedules retry when the composed delivery is interrupted", async () => {
  const x = blockedStorage({ [SYNC_OUTBOX_KEY]: [payload] });
  x.gate.resolve();
  let requestSignal: AbortSignal | undefined;
  const request = vi.fn<typeof fetch>((_url, init) => {
    requestSignal = init?.signal as AbortSignal;
    return new Promise(() => {});
  });
  const transport = createWatchTransportEffect(
    "https://example.com/watch",
    request,
  );
  const manager = createOutboxManager(
    x.storage,
    () =>
      transport("test", payload).pipe(
        Effect.map(() => ({ ok: true, retryable: false })),
        Effect.mapError(
          (cause) => new ExtensionFailure({ operation: "transport", cause }),
        ),
      ),
    { now: () => 100 },
  );
  const controller = new AbortController();
  const interrupted = expect(
    runExtension(manager.effects.flush, controller.signal),
  ).rejects.toBeDefined();
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  controller.abort();
  await interrupted;
  expect(requestSignal?.aborted).toBe(true);
  expect(x.values[SYNC_OUTBOX_KEY]).toEqual([payload]);
  expect(x.values[SYNC_RETRY_KEY]).toEqual({ attempt: 1, nextRetryAt: 60_100 });
});

it("shares a flush across callers and keeps delivery alive when only one caller cancels", async () => {
  const x = blockedStorage({ [SYNC_OUTBOX_KEY]: [payload] });
  x.gate.resolve();
  const gate = deferred<{ ok: boolean; retryable: boolean }>();
  const post = vi.fn(() => external("post", () => gate.promise));
  const manager = createOutboxManager(x.storage, post);
  const controller = new AbortController();
  const interrupted = expect(
    runExtension(manager.effects.flush, controller.signal),
  ).rejects.toBeDefined();
  const other = manager.flush();
  await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
  controller.abort();
  await interrupted;
  gate.resolve({ ok: true, retryable: false });
  await expect(other).resolves.toBe(true);
  expect(post).toHaveBeenCalledOnce();
  expect(x.values[SYNC_OUTBOX_KEY]).toEqual([]);
});
