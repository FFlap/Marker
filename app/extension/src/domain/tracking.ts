import { Effect, Schema } from "effect";
import { external, runExtension } from "./effects";
import type { EpisodeBookmark } from "./types";
const SavedResponse = Schema.Struct({ changed: Schema.Boolean });
export class BookmarkSaveError extends Schema.TaggedError<BookmarkSaveError>()(
  "BookmarkSaveError",
  { message: Schema.String },
) {}
const saveDetectedEpisode = Effect.fn("saveDetectedEpisode")(function* (
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown>,
) {
  const response = yield* external("message.bookmark.save", () =>
    send({ type: "bookmark/save", bookmark }),
  );
  return yield* Schema.decodeUnknownEffect(SavedResponse)(response).pipe(
    Effect.map((value) => value.changed),
    Effect.mapError(() => new BookmarkSaveError({
      message: "The background could not save the episode",
    })),
  );
});
export function persistDetectedEpisode(
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown> = (message) =>
    browser.runtime.sendMessage(message),
  signal?: AbortSignal,
): Promise<boolean> {
  return runExtension(
    saveDetectedEpisode(bookmark, send),
    signal,
  );
}
