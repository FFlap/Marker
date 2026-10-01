import { afterEach, describe, expect, it, vi } from "vitest";
import { persistDetectedEpisode } from "./tracking";

const bookmark = {
  platform: "netflix" as const,
  seriesId: "x",
  seriesTitle: "Dark",
  seriesUrl: "https://netflix.com",
  seasonNumber: "1",
  episodeNumber: "2",
  episodeTitle: "Lies",
  episodeId: "e",
  watchUrl: "https://netflix.com/watch/e",
  updatedAt: 1,
};

describe("background-owned tracking", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([undefined, { ok: false, reason: "background-error" }])("retries a failed background save: %o", async (response) => {
    await expect(
      persistDetectedEpisode(bookmark, async () => response),
    ).rejects.toThrow("The background could not save the episode");
  });

  it("uses browser.runtime as the receiver for default bookmark messages", async () => {
    const runtime = {
      sendMessage: vi.fn(function (this: unknown, message: unknown) {
        if (this !== runtime) throw new Error("wrong receiver");
        return Promise.resolve(
          (message as { type?: string }).type === "bookmark/save"
            ? { changed: true }
            : undefined,
        );
      }),
    };
    vi.stubGlobal("browser", { runtime });
    await persistDetectedEpisode(bookmark);

    expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
