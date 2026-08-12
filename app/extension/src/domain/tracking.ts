import type { EpisodeBookmark } from "./types";
import { buildWatchPayload, SYNC_LAST_RESULT_KEY } from "./sync";

export interface LocalStorageArea {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
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
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown> = (message) =>
    browser.runtime.sendMessage(message),
): Promise<boolean> {
  const response = (await send({ type: "bookmark/save", bookmark })) as {
    changed?: unknown;
  };
  return response.changed === true;
}
