import type { EpisodeBookmark } from "./types";
import { buildWatchPayload } from "./sync";

export async function syncDetectedEpisode(
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown> = (message) =>
    browser.runtime.sendMessage(message),
): Promise<void> {
  try {
    const payload = buildWatchPayload(bookmark);
    if (!payload) {
      await send({
        type: "sync/unsupported",
        seriesTitle: bookmark.seriesTitle.trim().slice(0, 300) || "Unknown title",
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
  } | undefined;
  if (typeof response?.changed !== "boolean")
    throw new Error("The background could not save the episode");
  return response.changed;
}
