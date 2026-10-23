import type { FunctionReturnType } from "convex/server";
import type { api } from "@marker/shared/api";
import { Effect, Option, Schema } from "effect";

type SearchResponse = FunctionReturnType<typeof api.tmdb.searchMulti>[number];
export type SearchResult = Pick<SearchResponse, "id" | "title" | "mediaType"> &
  Partial<SearchResponse> & {
    runtime?: number;
    genres?: string[];
  };
export type TitleDetail = NonNullable<
  FunctionReturnType<typeof api.resolvedMetadata.reads.getTitle>
>;
export type SeasonPage = FunctionReturnType<
  typeof api.resolvedMetadata.reads.getSeasonView
>["page"][number];
export const TITLE_SEARCH_MAX_LENGTH = 100;

const previewField = <S extends Schema.Constraint>(schema: S) =>
  Schema.catchDecoding<Schema.optional<S>>(() => Effect.succeed(Option.none()))(
    Schema.optional(schema),
  );
const TitlePreview = Schema.fromJsonString(Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  title: Schema.String,
  mediaType: Schema.Literals(["movie", "tv"]),
  posterPath: previewField(Schema.String),
  overview: previewField(Schema.String),
  releaseDate: previewField(Schema.String),
  runtime: previewField(Schema.Finite),
  genres: previewField(Schema.mutable(Schema.Array(Schema.String))),
}));

export const parseTitlePreview = (value: string | undefined): SearchResult | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(TitlePreview)(value));

export function titleRuntime(
  title: Pick<TitleDetail, "runtime" | "episodeRunTime"> | null | undefined,
  fallback?: number,
) {
  return title?.runtime ?? title?.episodeRunTime.find((value) => value > 0) ?? fallback;
}
