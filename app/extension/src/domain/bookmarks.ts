import type { BookmarkStore, EpisodeBookmark } from "./types";

const EMPTY_BOOKMARK_STORE: BookmarkStore = {
  version: 1,
  bookmarks: {},
};

const STORE_FIELDS = new Set(["version", "bookmarks"]);
const BOOKMARK_FIELDS = new Set([
  "platform",
  "seriesId",
  "seriesTitle",
  "seriesUrl",
  "seasonNumber",
  "episodeNumber",
  "episodeTitle",
  "episodeId",
  "watchUrl",
  "updatedAt",
]);
const PROVIDER_ORIGINS: Record<EpisodeBookmark["platform"], Set<string>> = {
  crunchyroll: new Set([
    "https://www.crunchyroll.com",
    "https://crunchyroll.com",
  ]),
  netflix: new Set(["https://www.netflix.com", "https://netflix.com"]),
};
const STRING_LIMITS = {
  seriesId: 200,
  seriesTitle: 300,
  seriesUrl: 1_000,
  seasonNumber: 300,
  episodeNumber: 100,
  episodeTitle: 300,
  episodeId: 200,
  watchUrl: 1_000,
} as const;

function exactFields(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim()
  );
}

function boundedCoordinate(
  value: unknown,
  maximumLength: number,
): value is string {
  if (!boundedString(value, maximumLength)) return false;
  const numeric = Number(value);
  return (
    Number.isNaN(numeric) ||
    (Number.isFinite(numeric) && numeric >= 0 && numeric <= 10_000)
  );
}

export function validatedProviderUrl(
  value: string,
  platform?: EpisodeBookmark["platform"],
) {
  try {
    const url = new URL(value);
    const allowed = platform
      ? PROVIDER_ORIGINS[platform].has(url.origin)
      : Object.values(PROVIDER_ORIGINS).some((origins) =>
          origins.has(url.origin),
        );
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

export function bookmarkKey(
  bookmark: Pick<EpisodeBookmark, "platform" | "seriesId">,
) {
  return `${bookmark.platform}:${bookmark.seriesId}`;
}

function isBookmark(value: unknown): value is EpisodeBookmark {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!exactFields(item, BOOKMARK_FIELDS)) return false;
  const platform = item.platform;
  return (
    (platform === "crunchyroll" || platform === "netflix") &&
    boundedString(item.seriesId, STRING_LIMITS.seriesId) &&
    boundedString(item.seriesTitle, STRING_LIMITS.seriesTitle) &&
    boundedString(item.seriesUrl, STRING_LIMITS.seriesUrl) &&
    boundedCoordinate(item.seasonNumber, STRING_LIMITS.seasonNumber) &&
    boundedCoordinate(item.episodeNumber, STRING_LIMITS.episodeNumber) &&
    boundedString(item.episodeTitle, STRING_LIMITS.episodeTitle) &&
    boundedString(item.episodeId, STRING_LIMITS.episodeId) &&
    boundedString(item.watchUrl, STRING_LIMITS.watchUrl) &&
    typeof item.updatedAt === "number" &&
    Number.isFinite(item.updatedAt) &&
    Number.isSafeInteger(item.updatedAt) &&
    item.updatedAt >= 0 &&
    validatedProviderUrl(item.seriesUrl, platform) !== null &&
    validatedProviderUrl(item.watchUrl, platform) !== null
  );
}

export function validateBookmark(value: unknown): EpisodeBookmark | null {
  return isBookmark(value) ? value : null;
}

export function normalizeBookmarkStore(value: unknown): BookmarkStore {
  if (!value || typeof value !== "object")
    return { ...EMPTY_BOOKMARK_STORE, bookmarks: {} };
  const candidate = value as Record<string, unknown>;
  if (
    !exactFields(candidate, STORE_FIELDS) ||
    candidate.version !== 1 ||
    !candidate.bookmarks ||
    typeof candidate.bookmarks !== "object" ||
    Array.isArray(candidate.bookmarks)
  ) {
    return { ...EMPTY_BOOKMARK_STORE, bookmarks: {} };
  }

  const bookmarks: Record<string, EpisodeBookmark> = {};
  for (const [key, bookmark] of Object.entries(
    candidate.bookmarks as Record<string, unknown>,
  )) {
    const migrated =
      bookmark &&
      typeof bookmark === "object" &&
      !Array.isArray(bookmark) &&
      (bookmark as Record<string, unknown>).platform === undefined
        ? { platform: "crunchyroll", ...bookmark }
        : bookmark;
    if (isBookmark(migrated) && key === bookmarkKey(migrated))
      bookmarks[key] = migrated;
  }
  return { version: 1, bookmarks };
}

export function mergeBookmark(
  store: BookmarkStore,
  bookmark: EpisodeBookmark,
): BookmarkStore {
  const validated = validateBookmark(bookmark);
  if (!validated) return store;
  return {
    version: 1,
    bookmarks: {
      ...store.bookmarks,
      [bookmarkKey(validated)]: validated,
    },
  };
}

export function sortBookmarks(
  bookmarks: Record<string, EpisodeBookmark>,
): EpisodeBookmark[] {
  return Object.values(bookmarks).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export type BookmarkStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export function createBookmarkOperations(
  storage: BookmarkStorage,
  storageKey: string,
) {
  let pending = Promise.resolve();
  const update = <T>(
    transform: (store: BookmarkStore) => { store: BookmarkStore; result: T },
  ) => {
    const operation = pending.then(async () => {
      const stored = await storage.get(storageKey);
      const next = transform(normalizeBookmarkStore(stored[storageKey]));
      await storage.set({
        [storageKey]: next.store,
      });
      return next.result;
    });
    pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
  return {
    save: (value: unknown) =>
      update((store) => {
        const bookmark = validateBookmark(value);
        if (!bookmark) return { store, result: false };
        const previous = store.bookmarks[bookmarkKey(bookmark)];
        const unchanged =
          previous?.episodeId === bookmark.episodeId &&
          previous.seasonNumber === bookmark.seasonNumber &&
          previous.episodeNumber === bookmark.episodeNumber;
        return {
          store: unchanged ? store : mergeBookmark(store, bookmark),
          result: !unchanged,
        };
      }),
    remove: (key: string) =>
      update((store) => {
        const bookmarks = { ...store.bookmarks };
        delete bookmarks[key];
        return {
          store: { version: 1, bookmarks },
          result: undefined,
        };
      }),
    clear: () =>
      update(() => ({
        store: { version: 1, bookmarks: {} },
        result: undefined,
      })),
  };
}
