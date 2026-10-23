import { Effect, Schema } from "effect";
import { external, runExtension } from "./effects";
import type { EpisodeBookmark } from "./types";
const SavedResponse = Schema.Struct({ changed: Schema.Boolean });
export function persistDetectedEpisode(
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown> = (message) =>
    browser.runtime.sendMessage(message),
  signal?: AbortSignal,
): Promise<boolean> {
  return runExtension(
    Effect.gen(function* () {
      const response = yield* external("message.bookmark.save", () =>
        send({ type: "bookmark/save", bookmark }),
      );
      if (!Schema.is(SavedResponse)(response))
        return yield* Effect.fail(
          new Error("The background could not save the episode"),
        );
      return response.changed;
    }),
    signal,
  );
}
