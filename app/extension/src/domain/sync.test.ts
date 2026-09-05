import { describe, expect, it, vi } from "vitest";
import { buildWatchPayload, createOutboxManager, parseWatchPayload, SYNC_OUTBOX_KEY, SYNC_OUTBOX_MAX, SYNC_RETRY_ALARM, SYNC_RETRY_KEY } from "./sync";

const payload = { service: "netflix" as const, seriesTitle: "Dark", seasonNumber: 1, episodeNumber: 2 };
const bookmark = {
  platform: "netflix" as const,
  seriesId: "dark",
  seriesTitle: "Dark",
  seriesUrl: "https://www.netflix.com/title/dark",
  seasonNumber: "1",
  episodeNumber: "2",
  episodeTitle: "",
  episodeId: "episode-2",
  watchUrl: "",
  updatedAt: 1,
};
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const storageFor = (values: Record<string, unknown>) => ({
  get: async () => ({ ...values }),
  set: async (next: Record<string, unknown>) => {
    Object.assign(values, next);
  },
});

describe("background-owned sync outbox", () => {
  it("builds supported watch payloads", () => {
    expect(buildWatchPayload({ ...bookmark, seasonNumber: "Specials" })).toMatchObject({ seasonNumber: 0 });
    expect(buildWatchPayload({
      ...bookmark,
      platform: "crunchyroll",
      seriesTitle: "Rascal Does Not Dream Series",
      seasonNumber: "  Rascal Does Not Dream of Bunny Girl Senpai  ",
      episodeNumber: "1",
      episodeTitle: "My Senpai is a Bunny Girl",
    })).toEqual({
      service: "crunchyroll",
      seriesTitle: "Rascal Does Not Dream Series",
      seasonTitle: "Rascal Does Not Dream of Bunny Girl Senpai",
      episodeNumber: 1,
      episodeTitle: "My Senpai is a Bunny Girl",
    });
    expect(buildWatchPayload({ ...bookmark, seasonNumber: " 2 " })).toEqual({
      ...payload,
      seasonNumber: 2,
    });
  });
  it("prefers episode titles for specials and unreliable decimal labels", () => {
    expect(buildWatchPayload({ ...bookmark, seasonNumber: "Specials", episodeTitle: "OVA" })).toEqual({ service: "netflix", seriesTitle: "Dark", episodeNumber: 2, episodeTitle: "OVA" });
    expect(buildWatchPayload({ ...bookmark, episodeNumber: "2.5", episodeTitle: "Recap" })).toEqual({ service: "netflix", seriesTitle: "Dark", episodeTitle: "Recap" });
    expect(buildWatchPayload({ ...bookmark, episodeNumber: "2.5" })).toBeNull();
    expect(buildWatchPayload(bookmark)).toEqual(payload);
  });
  it("rejects payloads with unknown fields", () => {
    expect(parseWatchPayload({
      platform: "netflix",
      seriesTitle: "Dark",
      seasonNumber: 1,
      episodeNumber: 2,
      watchUrl: "https://www.netflix.com/watch/2",
    })).toBeNull();
    expect(parseWatchPayload({ ...payload, url: "javascript:alert(1)" })).toBeNull();
    expect(parseWatchPayload({ ...payload, seriesTitle: "x".repeat(301) })).toBeNull();
  });
  it("preserves and accepts a valid HTTPS watch URL", () => {
    const url = "https://www.netflix.com/watch/2";
    expect(buildWatchPayload({ ...bookmark, watchUrl: url })).toEqual({
      ...payload,
      url,
    });
    expect(parseWatchPayload({ ...payload, url })).toEqual({
      ...payload,
      url,
    });
  });
  it("deduplicates title-matched events by normalized episode title", async () => {
    const values: Record<string, unknown> = {};
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const manager = createOutboxManager(storage, async () => ({ ok: false, retryable: true }));
    await manager.enqueue({ service: "netflix", seriesTitle: "Dark", episodeTitle: " Recap " });
    await manager.enqueue({ service: "netflix", seriesTitle: "dark", episodeTitle: "recap" });
    expect(values[SYNC_OUTBOX_KEY]).toHaveLength(1);
  });
  it("keeps distinct franchise season titles in the outbox", async () => {
    const values: Record<string, unknown> = {};
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const manager = createOutboxManager(storage, async () => ({ ok: false, retryable: true }));
    await manager.enqueue({ service: "crunchyroll", seriesTitle: "Container", seasonTitle: "Show A", episodeNumber: 1, episodeTitle: "Pilot" });
    await manager.enqueue({ service: "crunchyroll", seriesTitle: "Container", seasonTitle: "Show B", episodeNumber: 1, episodeTitle: "Pilot" });
    expect(values[SYNC_OUTBOX_KEY]).toHaveLength(2);
  });
  it("preserves a stored season title when the outbox is flushed", async () => {
    const titled = {
      service: "crunchyroll" as const,
      seriesTitle: "Container",
      seasonTitle: "Show A",
      episodeNumber: 1,
      episodeTitle: "Pilot",
    };
    const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [titled] };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const post = vi.fn(async () => ({ ok: true, retryable: false }));
    await createOutboxManager(storage, post).flush();
    expect(post).toHaveBeenCalledWith(titled);
  });
  it("preserves an event added by another context while a flush is in flight", async () => {
    const next = { ...payload, episodeNumber: 3 };
    const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [payload] };
    const gate = deferred<void>();
    const storage = {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    };
    const flushing = createOutboxManager(storage, async () => {
      await gate.promise;
      return { ok: true, retryable: false };
    }).flush();
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled());
    values[SYNC_OUTBOX_KEY] = [payload, next];
    gate.resolve();
    await flushing;
    expect(values[SYNC_OUTBOX_KEY]).toEqual([next]);
  });
  it("deduplicates mixed stored numeric and title payloads by either identity", async () => {
    const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [{ ...payload, episodeTitle: "Recap" }] };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const manager = createOutboxManager(storage, async () => ({ ok: false, retryable: true }));
    await manager.enqueue({ service: "netflix", seriesTitle: "dark", episodeTitle: "Recap" });
    expect(values[SYNC_OUTBOX_KEY]).toEqual([{ service: "netflix", seriesTitle: "dark", episodeTitle: "Recap" }]);
  });
  it("serializes cross-context enqueues and reads latest storage inside each operation", async () => {
    const values: Record<string, unknown> = {};
    const gate = deferred<void>(); let gets = 0;
    const storage = {
      get: vi.fn(async () => { if (++gets === 1) await gate.promise; return { ...values }; }),
      set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }),
    };
    const post = vi.fn(async () => ({ ok: false, retryable: true }));
    const manager = createOutboxManager(storage, post);
    const first = manager.enqueue(payload);
    const secondPayload = { ...payload, episodeNumber: 3 };
    const second = manager.enqueue(secondPayload);
    gate.resolve(); await Promise.all([first, second]);
    expect(values[SYNC_OUTBOX_KEY]).toEqual([payload, secondPayload]);
  });
  it("keeps only the newest entries when the outbox reaches its cap", async () => {
    const values: Record<string, unknown> = {};
    const manager = createOutboxManager(storageFor(values), async () => ({ ok: false, retryable: true }));
    for (let episodeNumber = 0; episodeNumber < SYNC_OUTBOX_MAX + 2; episodeNumber += 1) {
      // Queue operations are intentionally sequential so each one sees the prior write.
      // eslint-disable-next-line no-await-in-loop
      await manager.enqueue({ ...payload, episodeNumber });
    }
    const stored = values[SYNC_OUTBOX_KEY] as Array<{ episodeNumber: number }>;
    expect(stored).toHaveLength(SYNC_OUTBOX_MAX);
    expect(stored[0]?.episodeNumber).toBe(2);
  });
  it("prunes invalid stored entries even when no payload is delivered", async () => {
    const values: Record<string, unknown> = {
      [SYNC_OUTBOX_KEY]: [{ invalid: true }, payload],
    };
    await createOutboxManager(
      storageFor(values),
      async () => ({ ok: false, retryable: true }),
    ).flush();
    expect(values[SYNC_OUTBOX_KEY]).toEqual([payload]);
  });
  it("treats an unexpected delivery rejection as retryable", async () => {
    const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [payload] };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    await createOutboxManager(storage, async () => {
      throw new Error("unexpected failure");
    }).flush();
    expect(values[SYNC_OUTBOX_KEY]).toEqual([payload]);
    expect(values[SYNC_RETRY_KEY]).toMatchObject({ attempt: 1 });
  });
  it("persists before attempting delivery", async () => {
    const order: string[] = []; const values: Record<string, unknown> = {};
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { order.push("persist"); Object.assign(values, next); } };
    const manager = createOutboxManager(storage, async () => { order.push("deliver"); return { ok: true, retryable: false }; });
    await manager.enqueue(payload);
    expect(order).not.toContain("deliver");
    await manager.flush();
    expect(order.indexOf("deliver")).toBeGreaterThan(order.indexOf("persist"));
  });
  it("keeps retryable results queued and dequeues terminal results", async () => {
    const values: Record<string, unknown> = {}; const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const retry = createOutboxManager(storage, async () => ({ ok: false, retryable: true }));
    await retry.enqueue(payload); expect(values[SYNC_OUTBOX_KEY]).toEqual([payload]);
    const terminal = createOutboxManager(storage, async () => ({ ok: false, reason: "rejected", retryable: false }));
    await terminal.flush(); expect(values[SYNC_OUTBOX_KEY]).toEqual([]);
  });
  it("persists retry attempts and schedules bounded backoff", async () => {
    const values: Record<string, unknown> = {};
    const storage = { get: vi.fn(async () => ({ ...values })), set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }) };
    const alarms = { schedule: vi.fn(), clear: vi.fn() };
    const manager = createOutboxManager(storage, async () => ({ ok: false, retryable: true }), { now: () => 1_000, alarms });
    await manager.enqueue(payload);
    expect(values[SYNC_RETRY_KEY]).toEqual({ attempt: 0, nextRetryAt: 61_000 });
    expect(alarms.schedule).toHaveBeenCalledWith(SYNC_RETRY_ALARM, 61_000);
    await manager.flush();
    expect(values[SYNC_RETRY_KEY]).toEqual({ attempt: 1, nextRetryAt: 61_000 });
    await manager.flush();
    expect(values[SYNC_RETRY_KEY]).toEqual({ attempt: 2, nextRetryAt: 301_000 });
  });
  it("repairs non-positive stored retry attempts", async () => {
    const values: Record<string, unknown> = {
      [SYNC_OUTBOX_KEY]: [payload],
      [SYNC_RETRY_KEY]: { attempt: -2, nextRetryAt: 0 },
    };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    await createOutboxManager(
      storage,
      async () => ({ ok: false, retryable: true }),
      { now: () => 1_000 },
    ).flush();
    expect(values[SYNC_RETRY_KEY]).toEqual({
      attempt: 1,
      nextRetryAt: 61_000,
    });
  });
  it("clears retry scheduling after success", async () => {
    const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [payload], [SYNC_RETRY_KEY]: { attempt: 2, nextRetryAt: 1000 } };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const alarms = { schedule: vi.fn(), clear: vi.fn() };
    await createOutboxManager(storage, async () => ({ ok: true, retryable: false }), { alarms }).flush();
    expect(values[SYNC_RETRY_KEY]).toBeNull();
    expect(alarms.clear).toHaveBeenCalledWith(SYNC_RETRY_ALARM);
  });
  it("flushes when a due retry alarm fires", async () => {
    const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [payload], [SYNC_RETRY_KEY]: { attempt: 1, nextRetryAt: 1000 } };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const post = vi.fn(async () => ({ ok: true, retryable: false }));
    await createOutboxManager(storage, post, { now: () => 1000 }).alarmFired();
    expect(post).toHaveBeenCalledWith(payload);
  });
  it("does not flush before a retry alarm is due", async () => {
    const values: Record<string, unknown> = {
      [SYNC_OUTBOX_KEY]: [payload],
      [SYNC_RETRY_KEY]: { attempt: 1, nextRetryAt: 2_000 },
    };
    const storage = { get: async () => ({ ...values }), set: async (next: Record<string, unknown>) => { Object.assign(values, next); } };
    const post = vi.fn(async () => ({ ok: true, retryable: false }));
    await expect(
      createOutboxManager(storage, post, { now: () => 1_000 }).alarmFired(),
    ).resolves.toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});

it('clears the outbox even when authentication preparation fails', async () => {
  const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [payload] };
  const manager = createOutboxManager(storageFor(values), vi.fn(), {
    prepare: async () => { throw new Error('Authentication unavailable'); },
  });
  await manager.clear();
  expect(values[SYNC_OUTBOX_KEY]).toBeNull();
});

it('keeps distinct numbered episodes that share a title', async () => {
  const values: Record<string, unknown> = {};
  const manager = createOutboxManager(storageFor(values), async () => ({ ok: false, retryable: true }));
  await manager.enqueue({ ...payload, episodeTitle: 'Episode One' });
  await manager.enqueue({ ...payload, seasonNumber: 2, episodeTitle: 'Episode One' });
  await manager.enqueue({ ...payload, episodeNumber: 3, episodeTitle: 'Episode One' });
  expect(values[SYNC_OUTBOX_KEY]).toHaveLength(3);
});

it('does not resume or restore a batch cleared during delivery', async () => {
  const values: Record<string, unknown> = { [SYNC_OUTBOX_KEY]: [payload, { ...payload, episodeNumber: 3 }] };
  const gate = deferred<void>();
  const post = vi.fn(async () => { await gate.promise; return { ok: true, retryable: false }; });
  const manager = createOutboxManager(storageFor(values), post);
  const flushing = manager.flush();
  await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
  await manager.clear();
  gate.resolve();
  await flushing;
  expect(post).toHaveBeenCalledOnce();
  expect(values[SYNC_OUTBOX_KEY]).toBeNull();
});
