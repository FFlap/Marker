import { Effect, Exit, Schema } from "effect";
import {
  ExtensionStorage,
  createFifo,
  runExtension,
  storageService,
} from "./effects";
import type { BookmarkStore, EpisodeBookmark } from "./types";

export const BOOKMARKS_STORAGE_KEY = "markerBookmarks";

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

const boundedString = (maximum: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) =>
        value.length > 0 && value.length <= maximum && value === value.trim(),
    ),
  );
const boundedCoordinate = (maximum: number) =>
  boundedString(maximum).check(
    Schema.makeFilter((value) => {
      const numeric = Number(value);
      return (
        Number.isNaN(numeric) ||
        (Number.isFinite(numeric) && numeric >= 0 && numeric <= 10_000)
      );
    }),
  );

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

export const BookmarkSchema = Schema.Struct({
  platform: Schema.Literals(["crunchyroll", "netflix"]),
  seriesId: boundedString(STRING_LIMITS.seriesId),
  seriesTitle: boundedString(STRING_LIMITS.seriesTitle),
  seriesUrl: boundedString(STRING_LIMITS.seriesUrl),
  seasonNumber: boundedCoordinate(STRING_LIMITS.seasonNumber),
  episodeNumber: boundedCoordinate(STRING_LIMITS.episodeNumber),
  episodeTitle: boundedString(STRING_LIMITS.episodeTitle),
  episodeId: boundedString(STRING_LIMITS.episodeId),
  watchUrl: boundedString(STRING_LIMITS.watchUrl),
  updatedAt: Schema.Number.check(
    Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
  ),
})
  .check(
    Schema.makeFilter(
      (item) =>
        validatedProviderUrl(item.seriesUrl, item.platform) !== null &&
        validatedProviderUrl(item.watchUrl, item.platform) !== null,
    ),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeBookmark = Schema.decodeUnknownExit(BookmarkSchema);
const StoreSchema = Schema.Struct({
  version: Schema.Literal(1),
  bookmarks: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export function validateBookmark(value: unknown): EpisodeBookmark | null {
  return Exit.isSuccess(decodeBookmark(value, { onExcessProperty: "error" }))
    ? (value as EpisodeBookmark)
    : null;
}

export function normalizeBookmarkStore(value: unknown): BookmarkStore {
  const decoded = Schema.decodeUnknownExit(StoreSchema)(value, {
    onExcessProperty: "error",
  });
  if (Exit.isFailure(decoded)) return { version: 1, bookmarks: {} };
  const candidate = decoded.value;

  const bookmarks: Record<string, EpisodeBookmark> = {};
  for (const [key, bookmark] of Object.entries(
    candidate.bookmarks as Record<string, unknown>,
  )) {
    const validated = validateBookmark(bookmark);
    if (validated && key === bookmarkKey(validated)) bookmarks[key] = validated;
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
  remove(key: string): Promise<void>;
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export function createBookmarkOperations(
  storage: BookmarkStorage,
  storageKey: string,
) {
  const serialize = createFifo();
  const service = storageService({
    ...storage,
    get: (key) => storage.get(key as string),
    set: (items) => storage.set(items),
  });
  const update = Effect.fnUntraced(
    function* <T>(
      transform: (store: BookmarkStore) => { store: BookmarkStore; result: T },
    ) {
      const storage = yield* ExtensionStorage;
      const stored = yield* storage.get(storageKey);
      const store = normalizeBookmarkStore(stored[storageKey]);
      const next = transform(store);
      if (next.store !== store)
        yield* storage.set({ [storageKey]: next.store });
      return next.result;
    },
    serialize,
    Effect.provideService(ExtensionStorage, service),
  );
  const effects = {
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
          store: mergeBookmark(store, bookmark),
          result: !unchanged,
        };
      }),
    remove: (key: string) =>
      update((store) => {
        if (!(key in store.bookmarks)) return { store, result: undefined };
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
  return {
    effects,
    save: (value: unknown) => runExtension(effects.save(value)),
    remove: (key: string) => runExtension(effects.remove(key)),
    clear: () => runExtension(effects.clear()),
  };
}
