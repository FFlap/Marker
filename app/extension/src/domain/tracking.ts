import {
  bookmarkKey,
  mergeBookmark,
  normalizeBookmarkStore,
  validateBookmark,
} from "./bookmarks";
import type { EpisodeBookmark } from "./types";
import { BOOKMARKS_STORAGE_KEY } from "../messages";
import { buildWatchPayload, SYNC_LAST_RESULT_KEY } from "./sync";

export interface LocalStorageArea {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const storageOperations = new WeakMap<object, Promise<void>>();

function serializeStorage<T>(
  storage: LocalStorageArea,
  operation: () => Promise<T>,
) {
  const previous = storageOperations.get(storage) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  storageOperations.set(
    storage,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export async function syncDetectedEpisode(
  storage: LocalStorageArea,
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown> = (message) =>
    browser.runtime.sendMessage(message),
): Promise<void> {
  try {
    const payload = buildWatchPayload(bookmark);
    if (!payload) {
      await storage.set({
        [SYNC_LAST_RESULT_KEY]: {
          ok: false,
          at: Date.now(),
          reason: "unsupported-episode",
          seriesTitle: bookmark.seriesTitle,
        },
      });
      return;
    }
    await send({ type: "sync/enqueue", payload });
  } catch {
    // Sync must never affect local episode tracking.
  }
}

export async function persistDetectedEpisode(
  storage: LocalStorageArea,
  bookmark: EpisodeBookmark,
): Promise<boolean> {
  return serializeStorage(storage, async () => {
    const validated = validateBookmark(bookmark);
    if (!validated) {
      const incoming = bookmark as unknown as Record<string, unknown>;
      const seriesTitle =
        typeof incoming.seriesTitle === "string" &&
        incoming.seriesTitle.trim() &&
        incoming.seriesTitle.length <= 300
          ? incoming.seriesTitle.trim()
          : undefined;
      await storage.set({
        [SYNC_LAST_RESULT_KEY]: {
          ok: false,
          at: Date.now(),
          reason: "unsupported-episode",
          ...(seriesTitle ? { seriesTitle } : {}),
        },
      });
      return false;
    }
    const stored = await storage.get(BOOKMARKS_STORAGE_KEY);
    const current = normalizeBookmarkStore(stored[BOOKMARKS_STORAGE_KEY]);
    const previous = current.bookmarks[bookmarkKey(validated)];

    if (
      previous?.episodeId === validated.episodeId &&
      previous.seasonNumber === validated.seasonNumber &&
      previous.episodeNumber === validated.episodeNumber
    ) {
      return false;
    }

    await storage.set({
      [BOOKMARKS_STORAGE_KEY]: mergeBookmark(current, validated),
    });
    return true;
  });
}
