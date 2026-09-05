import type { EpisodeBookmark } from "./types";
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
