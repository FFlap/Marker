import { DateTime, Exit, Schema } from 'effect';
import type { EpisodeBookmark } from './types';

const WATCH_PATH = /^\/watch\/(\d+)/;
const EPISODE_LABEL = /^E(\d+(?:\.\d+)?)$/i;

const NetflixId = Schema.Union([
  Schema.Natural,
  Schema.String.check(Schema.isPattern(/^\d+$/)),
]);
const Coordinate = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const SummaryFields = {
  id: NetflixId,
  seriesId: Schema.optional(NetflixId),
  episode: Schema.optional(Coordinate),
};
const NetflixVideoSummarySchema = Schema.Union([
  Schema.Struct({ ...SummaryFields, type: Schema.Literal('episode'), season: Coordinate }),
  Schema.Struct({ ...SummaryFields, type: Schema.Literal('movie'), season: Schema.optional(Coordinate) }),
]);
type NetflixVideoSummary = typeof NetflixVideoSummarySchema.Type;
const decodeSummary = Schema.decodeUnknownExit(NetflixVideoSummarySchema);
const decodeSummaryJson = Schema.decodeUnknownExit(Schema.fromJsonString(NetflixVideoSummarySchema));
const decodeEmbeddedJson = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export function parseNetflixWatchPath(pathname: string) {
  const match = WATCH_PATH.exec(pathname);
  return match?.[1] ? { videoId: match[1] } : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseEmbeddedSummary(
  document: Document,
  videoId: string,
): NetflixVideoSummary | null {
  const bridged = document.documentElement.dataset.netflixVideoSummary;
  if (bridged) {
    const summary = decodeSummaryJson(bridged);
    if (Exit.isSuccess(summary))
      return String(summary.value.id) === videoId ? summary.value : null;
  }

  for (const script of document.scripts) {
    const source = script.textContent ?? '';
    const cacheIndex = source.indexOf('netflix.falcorCache');
    if (cacheIndex < 0) continue;
    const videosIndex = source.indexOf('"videos"', cacheIndex);
    const videoIndex = source.indexOf(`"${videoId}"`, videosIndex);
    if (videosIndex < 0 || videoIndex < 0) continue;
    const match = /^"\d+"\s*:\s*\{\s*"summary"\s*:\s*\{[^{}]*"value"\s*:\s*(\{[^{}]*\})/.exec(source.slice(videoIndex));
    if (!match?.[1]) continue;
    const value = decodeEmbeddedJson(match[1]);
    if (Exit.isFailure(value)) continue;
    const summary = decodeSummary({ id: videoId, ...value.value });
    if (Exit.isSuccess(summary) && String(summary.value.id) === videoId)
      return summary.value;
  }
  return null;
}

function findMovieTitle(document: Document) {
  const watchingLabel = Array.from(document.querySelectorAll('div,span,p')).find(
    (element) => element.children.length === 0 &&
      element.textContent?.trim() === "You're watching",
  );
  return watchingLabel?.parentElement
    ?.querySelector('h1,h2,h3,h4')
    ?.textContent?.trim() ?? '';
}

export function parseNetflixPage(
  document: Document,
  url: URL,
  updatedAt = DateTime.toEpochMillis(DateTime.nowUnsafe()),
): EpisodeBookmark | null {
  const watch = parseNetflixWatchPath(url.pathname);
  if (!watch) return null;
  const summary = parseEmbeddedSummary(document, watch.videoId);
  if (!summary) return null;

  const titleContainer =
    document.querySelector<HTMLElement>('[data-uia="video-title"]');
  const renderedVideoId = titleContainer?.dataset.videoId;
  if (renderedVideoId && renderedVideoId !== watch.videoId) return null;

  const seriesTitle = titleContainer
    ?.querySelector('h1,h2,h3,h4')
    ?.textContent?.trim() ?? (
      summary.type === 'movie' ? findMovieTitle(document) : ''
    );
  if (!seriesTitle) return null;

  let seasonNumber = 'Movie';
  let episodeNumber = '1';
  let episodeTitle = seriesTitle;
  if (summary.type === 'episode') {
    const textParts = Array.from(titleContainer?.querySelectorAll('span,div') ?? []).flatMap(
      (element) => {
        if (element.children.length > 0) return [];
        const text = element.textContent?.trim();
        return text ? [text] : [];
      },
    );
    const episodeLabel = textParts.find((text) => EPISODE_LABEL.test(text));
    const resolvedEpisodeNumber =
      summary.episode !== undefined
        ? String(summary.episode)
        : episodeLabel ? EPISODE_LABEL.exec(episodeLabel)?.[1] : undefined;
    const resolvedEpisodeTitle = episodeLabel
      ? textParts.find((text) => text !== episodeLabel && text !== seriesTitle)
      : undefined;
    const resolvedSeasonNumber =
      summary.season !== undefined ? String(summary.season) : undefined;
    if (!resolvedEpisodeNumber || !resolvedEpisodeTitle || !resolvedSeasonNumber) return null;
    seasonNumber = resolvedSeasonNumber;
    episodeNumber = resolvedEpisodeNumber;
    episodeTitle = resolvedEpisodeTitle;
  }

  return {
    platform: 'netflix',
    seriesId: summary.seriesId ? String(summary.seriesId) : slugify(seriesTitle) || watch.videoId,
    seriesTitle,
    seriesUrl: summary.seriesId
      ? `${url.origin}/title/${summary.seriesId}`
      : `${url.origin}${url.pathname}`,
    seasonNumber,
    episodeNumber,
    episodeTitle,
    episodeId: watch.videoId,
    watchUrl: `${url.origin}${url.pathname}`,
    updatedAt,
  };
}
