import type { EpisodeBookmark } from './types';

const WATCH_PATH = /^\/watch\/(\d+)/;
const EPISODE_LABEL = /^E(\d+(?:\.\d+)?)$/i;

interface NetflixVideoSummary {
  type: 'episode' | 'movie';
  id?: number | string;
  episode?: number;
  season?: number;
  stale?: boolean;
}

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
    try {
      const summary = JSON.parse(bridged) as NetflixVideoSummary;
      if (summary.id !== undefined && String(summary.id) !== videoId) {
        return summary.type === 'episode'
          ? { type: 'episode', season: summary.season, stale: true }
          : null;
      }
      return summary;
    } catch {
      // Fall through to the server-rendered cache.
    }
  }

  for (const script of document.scripts) {
    const source = script.textContent ?? '';
    const cacheIndex = source.indexOf('netflix.falcorCache');
    if (cacheIndex < 0) continue;
    const videosIndex = source.indexOf('"videos"', cacheIndex);
    const videoIndex = source.indexOf(`"${videoId}"`, videosIndex);
    if (videosIndex < 0 || videoIndex < 0) continue;
    const section = source.slice(videoIndex, videoIndex + 2500);
    const type = /"type"\s*:\s*"(episode|movie)"/.exec(section)?.[1] as
      | 'episode'
      | 'movie'
      | undefined;
    if (!type) continue;
    const episode = /"episode"\s*:\s*(\d+)/.exec(section)?.[1];
    const season = /"season"\s*:\s*(\d+)/.exec(section)?.[1];
    return {
      type,
      id: videoId,
      episode: episode ? Number(episode) : undefined,
      season: season ? Number(season) : undefined,
    };
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
  updatedAt = Date.now(),
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

  const textParts = Array.from(titleContainer?.querySelectorAll('span,div') ?? [])
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
  const episodeLabel = textParts.find((text) => EPISODE_LABEL.test(text));
  const episodeNumber = episodeLabel
    ? EPISODE_LABEL.exec(episodeLabel)?.[1]
    : undefined;
  const episodeTitle = episodeLabel
    ? textParts.find((text) => text !== episodeLabel && text !== seriesTitle)
    : undefined;

  if (summary.type === 'episode') {
    const resolvedEpisodeNumber = !summary.stale && summary.episode
      ? String(summary.episode)
      : episodeNumber;
    const seasonNumber =
      summary.season !== undefined ? String(summary.season) : undefined;
    if (!resolvedEpisodeNumber || !episodeTitle || !seasonNumber) return null;

    return {
      platform: 'netflix',
      seriesId: slugify(seriesTitle),
      seriesTitle,
      seriesUrl: `${url.origin}/title/${watch.videoId}`,
      seasonNumber,
      episodeNumber: resolvedEpisodeNumber,
      episodeTitle,
      episodeId: watch.videoId,
      watchUrl: `${url.origin}${url.pathname}`,
      updatedAt,
    };
  }

  return {
    platform: 'netflix',
    seriesId: slugify(seriesTitle),
    seriesTitle,
    seriesUrl: `${url.origin}/title/${watch.videoId}`,
    seasonNumber: 'Movie',
    episodeNumber: '1',
    episodeTitle: seriesTitle,
    episodeId: watch.videoId,
    watchUrl: `${url.origin}${url.pathname}`,
    updatedAt,
  };
}
