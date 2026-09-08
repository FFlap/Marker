import { describe, expect, it, vi } from "vitest";
import {
  createBookmarkOperations,
  mergeBookmark,
  normalizeBookmarkStore,
  sortBookmarks,
} from "./bookmarks";
import type { EpisodeBookmark } from "./types";

const slimeEpisode1: EpisodeBookmark = {
  platform: "crunchyroll",
  seriesId: "GYZJ43JMR",
  seriesTitle: "That Time I Got Reincarnated as a Slime",
  seriesUrl: "https://www.crunchyroll.com/series/GYZJ43JMR/slime",
  seasonNumber: "1",
  episodeNumber: "1",
  episodeTitle: "The Storm Dragon, Veldora",
  episodeId: "GRQW9GW7R",
  watchUrl:
    "https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora",
  updatedAt: 100,
};

describe("mergeBookmark", () => {
  it.each([
    { extra: true },
    { episodeTitle: "x".repeat(301) },
    { watchUrl: "https://example.com/watch/e" },
    { updatedAt: Number.NaN },
  ])(
    "drops invalid newly detected bookmarks without changing the store: %o",
    (patch) => {
      const store = {
        version: 1 as const,
        bookmarks: { "crunchyroll:GYZJ43JMR": slimeEpisode1 },
      };
      expect(
        mergeBookmark(store, {
          ...slimeEpisode1,
          seriesId: "INVALID",
          ...patch,
        } as EpisodeBookmark),
      ).toBe(store);
    },
  );

  it("replaces the previous episode for the same series", () => {
    const episode2 = {
      ...slimeEpisode1,
      episodeId: "G6245P09Y",
      episodeNumber: "2",
      episodeTitle: "Meeting the Goblins",
      watchUrl:
        "https://www.crunchyroll.com/watch/G6245P09Y/meeting-the-goblins",
      updatedAt: 200,
    };

    expect(
      mergeBookmark(
        { version: 1, bookmarks: { "crunchyroll:GYZJ43JMR": slimeEpisode1 } },
        episode2,
      ),
    ).toEqual({
      version: 1,
      bookmarks: { "crunchyroll:GYZJ43JMR": episode2 },
    });
  });

  it("keeps the same title separate across streaming platforms", () => {
    const netflix = {
      ...slimeEpisode1,
      platform: "netflix" as const,
      seriesId: "GYZJ43JMR",
      seriesUrl: "https://www.netflix.com/title/GYZJ43JMR",
      watchUrl: "https://www.netflix.com/watch/GRQW9GW7R",
      updatedAt: 300,
    };
    const result = mergeBookmark(
      { version: 1, bookmarks: { "crunchyroll:GYZJ43JMR": slimeEpisode1 } },
      netflix,
    );

    expect(Object.keys(result.bookmarks)).toEqual([
      "crunchyroll:GYZJ43JMR",
      "netflix:GYZJ43JMR",
    ]);
  });

  it("preserves bookmarks for other series", () => {
    const other = {
      ...slimeEpisode1,
      seriesId: "OTHER",
      seriesTitle: "Other Show",
    };
    const result = mergeBookmark(
      { version: 1, bookmarks: { "crunchyroll:OTHER": other } },
      slimeEpisode1,
    );

    expect(Object.keys(result.bookmarks)).toEqual([
      "crunchyroll:OTHER",
      "crunchyroll:GYZJ43JMR",
    ]);
  });
});

describe("sortBookmarks", () => {
  it("orders bookmarks from most recently updated", () => {
    const older = { ...slimeEpisode1, seriesId: "OLDER", updatedAt: 1 };
    const newer = { ...slimeEpisode1, seriesId: "NEWER", updatedAt: 2 };

    expect(
      sortBookmarks({
        "crunchyroll:OLDER": older,
        "crunchyroll:NEWER": newer,
      }).map((item) => item.seriesId),
    ).toEqual(["NEWER", "OLDER"]);
  });
});

describe("normalizeBookmarkStore", () => {
  it("returns an empty versioned store for malformed data", () => {
    expect(normalizeBookmarkStore({ version: 2, bookmarks: "bad" })).toEqual({
      version: 1,
      bookmarks: {},
    });
    expect(normalizeBookmarkStore(null)).toEqual({ version: 1, bookmarks: {} });
  });

  it("rejects bookmarks from unsupported platforms", () => {
    const netflix = {
      ...slimeEpisode1,
      platform: "netflix" as const,
      seriesUrl: "https://www.netflix.com/title/GYZJ43JMR",
      watchUrl: "https://www.netflix.com/watch/GRQW9GW7R",
    };
    expect(
      normalizeBookmarkStore({
        version: 1,
        bookmarks: {
          "hulu:GYZJ43JMR": { ...slimeEpisode1, platform: "hulu" },
          "netflix:GYZJ43JMR": netflix,
        },
      }).bookmarks,
    ).toEqual({
      "netflix:GYZJ43JMR": netflix,
    });
  });

  it("rejects bookmarks stored under noncanonical keys", () => {
    expect(
      normalizeBookmarkStore({
        version: 1,
        bookmarks: { GYZJ43JMR: slimeEpisode1 },
      }),
    ).toEqual({ version: 1, bookmarks: {} });
  });

  it("rejects bookmarks without an explicit platform", () => {
    const { platform: _platform, ...legacy } = slimeEpisode1;
    expect(
      normalizeBookmarkStore({
        version: 1,
        bookmarks: { "crunchyroll:GYZJ43JMR": legacy },
      }).bookmarks,
    ).toEqual({});
  });

  it("rejects unknown store and bookmark fields", () => {
    expect(
      normalizeBookmarkStore({ version: 1, bookmarks: {}, extra: true }),
    ).toEqual({ version: 1, bookmarks: {} });
    expect(
      normalizeBookmarkStore({
        version: 1,
        bookmarks: {
          "crunchyroll:GYZJ43JMR": { ...slimeEpisode1, extra: true },
        },
      }).bookmarks,
    ).toEqual({});
  });

  it("rejects non-finite or out-of-range timestamps and coordinates", () => {
    const invalid = {
      "crunchyroll:TIME": {
        ...slimeEpisode1,
        seriesId: "TIME",
        updatedAt: Number.POSITIVE_INFINITY,
      },
      "crunchyroll:SEASON": {
        ...slimeEpisode1,
        seriesId: "SEASON",
        seasonNumber: "-1",
      },
      "crunchyroll:EPISODE": {
        ...slimeEpisode1,
        seriesId: "EPISODE",
        episodeNumber: "10001",
      },
    };
    expect(
      normalizeBookmarkStore({ version: 1, bookmarks: invalid }).bookmarks,
    ).toEqual({});
  });

  it("rejects overlong persisted strings", () => {
    expect(
      normalizeBookmarkStore({
        version: 1,
        bookmarks: {
          "crunchyroll:GYZJ43JMR": {
            ...slimeEpisode1,
            episodeTitle: "x".repeat(301),
          },
        },
      }).bookmarks,
    ).toEqual({});
  });

  it("rejects non-HTTPS and non-provider bookmark URLs", () => {
    const invalid = {
      "crunchyroll:HTTP": {
        ...slimeEpisode1,
        seriesId: "HTTP",
        watchUrl: "http://www.crunchyroll.com/watch/episode",
      },
      "crunchyroll:FOREIGN": {
        ...slimeEpisode1,
        seriesId: "FOREIGN",
        seriesUrl: "https://example.com/series/FOREIGN",
      },
    };
    expect(
      normalizeBookmarkStore({ version: 1, bookmarks: invalid }).bookmarks,
    ).toEqual({});
  });
});

describe("bookmark operations", () => {
  it("refreshes unchanged bookmarks while reporting no episode change", async () => {
    let value: unknown = { version: 1, bookmarks: {} };
    const storage = {
      get: async () => ({ bookmarks: value }),
      set: async (items: Record<string, unknown>) => {
        value = items.bookmarks;
      },
    };
    const operations = createBookmarkOperations(storage, "bookmarks");

    expect(await operations.save(slimeEpisode1)).toBe(true);
    expect(
      await operations.save({ ...slimeEpisode1, updatedAt: 400 }),
    ).toBe(false);
    expect(
      normalizeBookmarkStore(value).bookmarks["crunchyroll:GYZJ43JMR"]
        ?.updatedAt,
    ).toBe(400);
  });

  it("rejects an invalid bookmark without writing", async () => {
    const set = vi.fn(async () => undefined);
    const operations = createBookmarkOperations(
      { get: async () => ({ bookmarks: { version: 1, bookmarks: {} } }), set },
      "bookmarks",
    );

    expect(await operations.save({ platform: "hulu" })).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("serializes overlapping removals against the latest stored bookmarks", async () => {
    let value: unknown = {
      version: 1,
      bookmarks: {
        "crunchyroll:FIRST": { ...slimeEpisode1, seriesId: "FIRST" },
        "crunchyroll:SECOND": { ...slimeEpisode1, seriesId: "SECOND" },
        "crunchyroll:THIRD": { ...slimeEpisode1, seriesId: "THIRD" },
      },
    };
    const storage = {
      get: async () => ({ bookmarks: value }),
      set: async (items: Record<string, unknown>) => {
        await Promise.resolve();
        value = items.bookmarks;
      },
    };
    const operations = createBookmarkOperations(storage, "bookmarks");

    await Promise.all([
      operations.remove("crunchyroll:FIRST"),
      operations.remove("crunchyroll:SECOND"),
    ]);

    expect(normalizeBookmarkStore(value).bookmarks).toEqual({
      "crunchyroll:THIRD": { ...slimeEpisode1, seriesId: "THIRD" },
    });
  });
});
