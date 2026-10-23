import { Option, Schema } from 'effect';
import type { SearchResult } from '@/types';

const MediaTypeSchema = Schema.Literals(['movie', 'tv']);
const TmdbId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const decodeMediaType = Schema.decodeUnknownOption(MediaTypeSchema);
const decodeTmdbId = Schema.decodeUnknownOption(
  Schema.NumberFromString.pipe(Schema.decodeTo(TmdbId)),
);
const decodePreview = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      id: TmdbId,
      title: Schema.String.check(Schema.isPattern(/\S/u)),
      originalTitle: Schema.optional(Schema.String),
      mediaType: MediaTypeSchema,
      posterPath: Schema.optional(
        Schema.String.check(
          Schema.isPattern(/^\/(?!\/)[A-Za-z0-9._/-]+$/u),
          Schema.isPattern(/^(?!.*\/\.\.(?:\/|$))/u),
        ),
      ),
      overview: Schema.optional(Schema.String),
      releaseDate: Schema.optional(Schema.String),
      voteAverage: Schema.optional(Schema.Finite),
    }),
  ),
);

export type MediaType = typeof MediaTypeSchema.Type;
export type TitleRouteParams = {
  mediaType?: string;
  tmdbId?: string;
  preview?: string;
};

export function parseTitleRoute(params: TitleRouteParams) {
  const mediaType = Option.getOrUndefined(decodeMediaType(params.mediaType));
  const id = decodeTmdbId(params.tmdbId);
  const tmdbId = Option.getOrElse(id, () => Number.NaN);
  const validId = Option.isSome(id);
  return {
    mediaType,
    tmdbId,
    validId,
    routeKey: `${mediaType ?? 'invalid'}:${validId ? tmdbId : 'invalid'}`,
  };
}

export function parseTitlePreview(value?: string): SearchResult | undefined {
  const preview = Option.getOrUndefined(decodePreview(value));
  if (!preview) return undefined;
  return {
    ...preview,
    originalTitle: preview.originalTitle,
    posterPath: preview.posterPath,
    overview: preview.overview,
    releaseDate: preview.releaseDate,
    voteAverage: preview.voteAverage,
  };
}
