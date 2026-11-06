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
    Effect.mapError(
      () =>
        new BookmarkSaveError({
          message: "The background could not save the episode",
        }),
    ),
  );
});
export function persistDetectedEpisode(
  bookmark: EpisodeBookmark,
  send: (message: unknown) => Promise<unknown> = (message) =>
    browser.runtime.sendMessage(message),
  signal?: AbortSignal,
): Promise<boolean> {
  return runExtension(saveDetectedEpisode(bookmark, send), signal);
}

export type InspectionState =
  | { state: "waiting" | "tracked" | "error"; lastEpisode: string | null }
  | { state: "saving"; lastEpisode: string | null; inspectAgain: boolean };
export type InspectionEvent =
  | { type: "navigate" }
  | { type: "inspect" }
  | { type: "save" }
  | { type: "saved"; episodeId: string }
  | { type: "failed" };

/** A single-flight inspection owns deduplication and the deferred inspection. */
export function transitionInspection(
  current: InspectionState,
  event: InspectionEvent,
): InspectionState {
  switch (event.type) {
    case "navigate":
      return { ...current, lastEpisode: null };
    case "inspect":
      return current.state === "saving"
        ? { ...current, inspectAgain: true }
        : current;
    case "save":
      return current.state === "saving"
        ? current
        : {
            state: "saving",
            lastEpisode: current.lastEpisode,
            inspectAgain: false,
          };
    case "saved":
      return { state: "tracked", lastEpisode: event.episodeId };
    case "failed":
      return { state: "error", lastEpisode: current.lastEpisode };
  }
}
