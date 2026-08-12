import { describe, expect, it, vi } from "vitest";
import { persistDetectedEpisode, syncDetectedEpisode } from "./tracking";
import { BOOKMARKS_STORAGE_KEY } from "../messages";

describe("persist-first tracking", () => {
  it("stores a detected episode", async () => {
    const values: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (next: Record<string, unknown>) => {
        Object.assign(values, next);
      },
    };
    const changed = await persistDetectedEpisode(storage, {
      platform: "netflix",
      seriesId: "x",
      seriesTitle: "Dark",
      seriesUrl: "https://netflix.com",
      seasonNumber: "1",
      episodeNumber: "2",
      episodeTitle: "Lies",
      episodeId: "e",
      watchUrl: "https://netflix.com/watch/e",
      updatedAt: 1,
    });
    expect(changed).toBe(true);
    expect(values[BOOKMARKS_STORAGE_KEY]).toBeTruthy();
  });
  it.each([
    { extra: true },
    { episodeTitle: "x".repeat(301) },
    { seriesUrl: "https://example.com/title/x" },
    { watchUrl: "http://www.netflix.com/watch/e" },
    { updatedAt: Number.POSITIVE_INFINITY },
  ])(
    "refuses invalid incoming detections and surfaces the drop: %o",
    async (patch) => {
      const existing = {
        version: 1,
        bookmarks: {
          "netflix:kept": {
            platform: "netflix",
            seriesId: "kept",
            seriesTitle: "Kept",
            seriesUrl: "https://www.netflix.com/title/kept",
            seasonNumber: "1",
            episodeNumber: "1",
            episodeTitle: "Pilot",
            episodeId: "pilot",
            watchUrl: "https://www.netflix.com/watch/pilot",
            updatedAt: 1,
          },
        },
      };
      const values: Record<string, unknown> = {
        [BOOKMARKS_STORAGE_KEY]: existing,
      };
      const storage = {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => {
          Object.assign(values, next);
        },
      };
      const incoming = {
        platform: "netflix",
        seriesId: "invalid",
        seriesTitle: "Invalid detection",
        seriesUrl: "https://www.netflix.com/title/invalid",
        seasonNumber: "1",
        episodeNumber: "2",
        episodeTitle: "Second",
        episodeId: "second",
        watchUrl: "https://www.netflix.com/watch/second",
        updatedAt: 2,
        ...patch,
      };

      await expect(
        persistDetectedEpisode(
          storage,
          incoming as Parameters<typeof persistDetectedEpisode>[1],
        ),
      ).resolves.toBe(false);
      expect(values[BOOKMARKS_STORAGE_KEY]).toEqual(existing);
      expect(values["sync.lastResult"]).toMatchObject({
        ok: false,
        reason: "unsupported-episode",
      });
    },
  );
  it("serializes overlapping detections so distinct shows are not lost", async () => {
    const values: Record<string, unknown> = {};
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const storage = {
      get: vi.fn(async () => {
        if (++reads === 1) await gate;
        return { ...values };
      }),
      set: vi.fn(async (next: Record<string, unknown>) => {
        Object.assign(values, next);
      }),
    };
    const base = {
      platform: "netflix" as const,
      seriesTitle: "Dark",
      seriesUrl: "https://netflix.com",
      seasonNumber: "1",
      episodeNumber: "2",
      episodeTitle: "Lies",
      episodeId: "e",
      watchUrl: "https://netflix.com/watch/e",
      updatedAt: 1,
    };
    const first = persistDetectedEpisode(storage, {
      ...base,
      seriesId: "dark",
    });
    const second = persistDetectedEpisode(storage, {
      ...base,
      seriesId: "arcane",
      seriesTitle: "Arcane",
    });
    release();
    await Promise.all([first, second]);
    const stored = values[BOOKMARKS_STORAGE_KEY] as {
      bookmarks: Record<string, unknown>;
    };
    expect(Object.keys(stored.bookmarks)).toHaveLength(2);
  });
  it("uses browser.runtime as the receiver for the default sync sender", async () => {
    const runtime = {
      sendMessage: vi.fn(function (this: unknown) {
        if (this !== runtime) throw new Error("wrong receiver");
        return Promise.resolve();
      }),
    };
    vi.stubGlobal("browser", { runtime });
    const storage = {
      get: async () => ({}),
      set: vi.fn(async () => undefined),
    };
    await syncDetectedEpisode(storage, {
      platform: "netflix",
      seriesId: "x",
      seriesTitle: "Dark",
      seriesUrl: "https://netflix.com",
      seasonNumber: "1",
      episodeNumber: "2",
      episodeTitle: "Lies",
      episodeId: "e",
      watchUrl: "https://netflix.com/watch/e",
      updatedAt: 1,
    });
    expect(runtime.sendMessage).toHaveBeenCalledOnce();
  });
});
