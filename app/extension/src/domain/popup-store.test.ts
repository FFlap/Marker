import { describe, expect, it, vi } from "vitest";
import { BOOKMARKS_STORAGE_KEY } from "./bookmarks";
import type { createPopupClient } from "./popup";
import { createPopupStore } from "./popup-store";
import { SYNC_LAST_RESULT_KEY } from "./sync";
import type { EpisodeBookmark } from "./types";

type Client = ReturnType<typeof createPopupClient>;
type StorageListener = Parameters<
  Parameters<typeof createPopupStore>[1]["addListener"]
>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const bookmarks = deferred<Awaited<ReturnType<Client["bookmarks"]>>>();
  const lastResult = deferred<Awaited<ReturnType<Client["lastResult"]>>>();
  const status = deferred<Awaited<ReturnType<Client["status"]>>>();
  const client = {
    bookmarks: vi.fn<Client["bookmarks"]>(() => bookmarks.promise),
    lastResult: vi.fn<Client["lastResult"]>(() => lastResult.promise),
    status: vi.fn<Client["status"]>(() => status.promise),
    mutate: vi.fn<Client["mutate"]>(async () => undefined),
  };
  const storageListeners = new Set<StorageListener>();
  const storageChanges = {
    addListener: vi.fn((listener: StorageListener) => {
      storageListeners.add(listener);
    }),
    removeListener: vi.fn((listener: StorageListener) => {
      storageListeners.delete(listener);
    }),
  };
  const emit = (changes: Parameters<StorageListener>[0], area = "local") => {
    storageListeners.forEach((listener) => listener(changes, area));
  };
  return {
    store: createPopupStore(client, storageChanges),
    client,
    bookmarks,
    lastResult,
    status,
    storageChanges,
    storageListeners,
    emit,
  };
}

const bookmark: EpisodeBookmark = {
  platform: "netflix",
  seriesId: "dark",
  seriesTitle: "Dark",
  seriesUrl: "https://www.netflix.com/title/dark",
  seasonNumber: "1",
  episodeNumber: "2",
  episodeTitle: "Lies",
  episodeId: "dark-2",
  watchUrl: "https://www.netflix.com/watch/dark-2",
  updatedAt: 1,
};

describe("popup external store", () => {
  it("starts on subscription and releases browser resources after the last subscriber", () => {
    const { store, client, storageChanges, storageListeners } = setup();
    const initial = store.getSnapshot();
    expect(store.getSnapshot()).toBe(initial);
    expect(client.bookmarks).not.toHaveBeenCalled();
    expect(storageListeners.size).toBe(0);

    const unsubscribeFirst = store.subscribe(vi.fn());
    const unsubscribeSecond = store.subscribe(vi.fn());
    expect(client.bookmarks).toHaveBeenCalledTimes(1);
    expect(storageChanges.addListener).toHaveBeenCalledTimes(1);
    const signal = client.bookmarks.mock.calls[0]![0]!;
    expect(signal.aborted).toBe(false);
    unsubscribeFirst();
    expect(signal.aborted).toBe(false);
    unsubscribeSecond();
    expect(signal.aborted).toBe(true);
    expect(storageListeners.size).toBe(0);
    expect(storageChanges.removeListener).toHaveBeenCalledWith(
      storageChanges.addListener.mock.calls[0]![0],
    );
  });

  it("preserves newer storage events while hydrating sign-in independently", async () => {
    const { store, bookmarks, lastResult, status, emit } = setup();
    const unsubscribe = store.subscribe(vi.fn());
    emit({
      [BOOKMARKS_STORAGE_KEY]: {
        newValue: { version: 1, bookmarks: { "netflix:dark": bookmark } },
      },
    });
    const latestResult = { ok: true, at: 10, seriesTitle: "Dark" };
    emit({ [SYNC_LAST_RESULT_KEY]: { newValue: latestResult } });
    bookmarks.resolve([]);
    lastResult.resolve({ ok: false, at: 1 });
    status.resolve({ signedIn: true, accountLabel: "@viewer" });
    await Promise.all([bookmarks.promise, lastResult.promise, status.promise]);
    expect(store.getSnapshot()).toMatchObject({
      bookmarks: [bookmark],
      lastResult: latestResult,
      signedIn: true,
      accountLabel: "@viewer",
    });
    unsubscribe();
  });

  it("ignores other storage areas and honors deletion of stored values", async () => {
    const { store, bookmarks, lastResult, emit } = setup();
    const unsubscribe = store.subscribe(vi.fn());
    bookmarks.resolve([bookmark]);
    lastResult.resolve({ ok: true, at: 1 });
    await Promise.all([bookmarks.promise, lastResult.promise]);
    const hydrated = store.getSnapshot();
    emit({ [BOOKMARKS_STORAGE_KEY]: { newValue: undefined } }, "sync");
    expect(store.getSnapshot()).toBe(hydrated);
    emit({
      [BOOKMARKS_STORAGE_KEY]: { newValue: undefined },
      [SYNC_LAST_RESULT_KEY]: { newValue: undefined },
    });
    expect(store.getSnapshot().bookmarks).toEqual([]);
    expect(store.getSnapshot().lastResult).toBeUndefined();
    unsubscribe();
  });

  it.each(["success", "failure"] as const)(
    "does not overwrite an explicit connection with a stale hydration %s",
    async (outcome) => {
      const { store, status } = setup();
      const unsubscribe = store.subscribe(vi.fn());
      store.startAuthChange();
      store.update({ signedIn: true, accountLabel: "@connected" });
      if (outcome === "success") status.resolve({ signedIn: false });
      else status.reject(new Error("obsolete"));
      await status.promise.catch(() => undefined);
      expect(store.getSnapshot()).toMatchObject({
        signedIn: true,
        accountLabel: "@connected",
      });
      expect(store.getSnapshot().syncError).toBeUndefined();
      unsubscribe();
    },
  );

  it("reconnects after cleanup and fences requests from the previous subscription", async () => {
    const { store, client, bookmarks, lastResult, status, storageListeners } =
      setup();
    const oldListener = vi.fn();
    const unsubscribe = store.subscribe(oldListener);
    unsubscribe();
    client.bookmarks.mockResolvedValueOnce([bookmark]);
    client.lastResult.mockResolvedValueOnce({ ok: true, at: 10 });
    client.status.mockResolvedValueOnce({
      signedIn: true,
      accountLabel: "@new",
    });
    const newListener = vi.fn();
    const disconnect = store.subscribe(newListener);
    await Promise.resolve();
    const current = store.getSnapshot();
    expect(current).toMatchObject({
      bookmarks: [bookmark],
      accountLabel: "@new",
    });
    expect(storageListeners.size).toBe(1);
    bookmarks.resolve([]);
    lastResult.reject(new Error("old request"));
    status.resolve({ signedIn: false });
    await Promise.allSettled([
      bookmarks.promise,
      lastResult.promise,
      status.promise,
    ]);
    expect(store.getSnapshot()).toBe(current);
    expect(oldListener).not.toHaveBeenCalled();
    disconnect();
    expect(storageListeners.size).toBe(0);
  });
});
