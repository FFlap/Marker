import type { EpisodeBookmark } from './types';

const WATCH_PATH = /^\/watch\/(\d+)/;
const EPISODE_LABEL = /^E(\d+(?:\.\d+)?)$/i;

interface NetflixVideoSummary {
  type: 'episode' | 'movie';
  id: number | string;
  seriesId?: number | string;
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

function seriesIdFor(title: string, videoId: string) {
  return slugify(title) || videoId;
}

function asSummary(value: unknown): NetflixVideoSummary | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'episode' && record.type !== 'movie') return null;
  if (typeof record.id !== 'number' && typeof record.id !== 'string') {
    return null;
  }
  if (
    record.seriesId !== undefined &&
    typeof record.seriesId !== 'number' &&
    typeof record.seriesId !== 'string'
  ) return null;
  if (record.episode !== undefined && typeof record.episode !== 'number') return null;
  if (record.type === 'episode' && typeof record.season !== 'number') return null;
  return {
    type: record.type,
    id: record.id,
    seriesId: record.seriesId as number | string | undefined,
    episode: record.episode as number | undefined,
    season: record.season as number | undefined,
  };
}

function parseEmbeddedSummary(
  document: Document,
  videoId: string,
): NetflixVideoSummary | null {
  const bridged = document.documentElement.dataset.netflixVideoSummary;
  if (bridged) {
    try {
      const summary = asSummary(JSON.parse(bridged));
      if (!summary) throw new Error('Unexpected summary shape');
      if (String(summary.id) !== videoId) {
        return summary.type === 'episode'
          ? { type: 'episode', id: summary.id, season: summary.season, stale: true }
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
    // Only accept this video's flat summary; the metadata bridge handles other cache shapes.
    const match = /^"\d+"\s*:\s*\{\s*"summary"\s*:\s*\{[^{}]*"value"\s*:\s*(\{[^{}]*\})/.exec(source.slice(videoIndex));
    if (!match?.[1]) continue;
    try {
      const summary = asSummary({ id: videoId, ...JSON.parse(match[1]) });
      if (summary && String(summary.id) === videoId) return summary;
    } catch {
      // Wait for the metadata bridge when the script is not valid JSON.
    }
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
  if (!summary || summary.stale) return null;

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

  const textParts = Array.from(titleContainer?.querySelectorAll('span,div') ?? []).flatMap(
    (element) => {
      if (element.children.length > 0) return [];
      const text = element.textContent?.trim();
      return text ? [text] : [];
    },
  );
  const episodeLabel = textParts.find((text) => EPISODE_LABEL.test(text));
  const episodeNumber = episodeLabel
    ? EPISODE_LABEL.exec(episodeLabel)?.[1]
    : undefined;
  const episodeTitle = episodeLabel
    ? textParts.find((text) => text !== episodeLabel && text !== seriesTitle)
    : undefined;

  if (summary.type === 'episode') {
    const resolvedEpisodeNumber =
      summary.episode !== undefined ? String(summary.episode) : episodeNumber;
    const seasonNumber =
      summary.season !== undefined ? String(summary.season) : undefined;
    if (!resolvedEpisodeNumber || !episodeTitle || !seasonNumber) return null;

    return {
      platform: 'netflix',
      seriesId: summary.seriesId ? String(summary.seriesId) : seriesIdFor(seriesTitle, watch.videoId),
      seriesTitle,
      seriesUrl: summary.seriesId
        ? `${url.origin}/title/${summary.seriesId}`
        : `${url.origin}${url.pathname}`,
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
    seriesId: summary.seriesId ? String(summary.seriesId) : seriesIdFor(seriesTitle, watch.videoId),
    seriesTitle,
    seriesUrl: summary.seriesId
      ? `${url.origin}/title/${summary.seriesId}`
      : `${url.origin}${url.pathname}`,
    seasonNumber: 'Movie',
    episodeNumber: '1',
    episodeTitle: seriesTitle,
    episodeId: watch.videoId,
    watchUrl: `${url.origin}${url.pathname}`,
    updatedAt,
  };
}
