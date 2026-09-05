import { afterEach, describe, expect, it, vi } from "vitest";
import { persistDetectedEpisode, syncDetectedEpisode } from "./tracking";

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

  it("routes detected bookmarks through the background owner", async () => {
    const send = vi.fn(async () => ({ changed: true }));
    await expect(persistDetectedEpisode(bookmark, send)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith({ type: "bookmark/save", bookmark });
  });

  it("returns false when the background reports no bookmark change", async () => {
    await expect(
      persistDetectedEpisode(bookmark, async () => ({ changed: false })),
    ).resolves.toBe(false);
  });

  it("asks the background to record an unsupported episode", async () => {
    const send = vi.fn(async () => undefined);
    await syncDetectedEpisode(
      { ...bookmark, seriesTitle: "x".repeat(301) },
      send,
    );
    expect(send).toHaveBeenCalledWith({
      type: "sync/unsupported",
      seriesTitle: "x".repeat(300),
    });
  });

  it.each([undefined, { ok: false, reason: "background-error" }])("retries a failed background save: %o", async (response) => {
    await expect(
      persistDetectedEpisode(bookmark, async () => response),
    ).rejects.toThrow("The background could not save the episode");
  });

  it("uses browser.runtime as the receiver for default bookmark and sync messages", async () => {
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
    await syncDetectedEpisode(bookmark);

    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});
