import type { EpisodeBookmark } from './types';

const WATCH_PATH = /^\/watch\/([A-Z0-9]+)\/([^/?#]+)/i;
const SERIES_PATH = /^\/series\/([A-Z0-9]+)\/([^/?#]+)/i;
const EPISODE_HEADING = /^E([A-Z0-9.-]+)\s*-\s*(.+)$/i;
const SEASON_TITLE = /\bSeason\s+([A-Z0-9.-]+)/i;

function parseSeasonCategory(title: string, episodeTitle: string) {
  const numberedSeason = SEASON_TITLE.exec(title)?.[1];
  if (numberedSeason) return numberedSeason;

  const suffix = `${episodeTitle} - Watch on Crunchyroll`;
  if (!title.endsWith(suffix)) return null;
  return title.slice(0, -suffix.length).trim() || null;
}

export function parseWatchPath(pathname: string) {
  const match = WATCH_PATH.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return { episodeId: match[1], slug: match[2] };
}

export function parseEpisodePage(
  document: Document,
  url: URL,
  updatedAt = Date.now(),
): EpisodeBookmark | null {
  const watch = parseWatchPath(url.pathname);
  if (!watch) return null;

  const seriesLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
    (link) => SERIES_PATH.test(new URL(link.href, url.origin).pathname),
  );
  const heading = document.querySelector<HTMLHeadingElement>('h1');
  const episode = EPISODE_HEADING.exec(heading?.textContent?.trim() ?? '');
  const season = episode?.[2]
    ? parseSeasonCategory(document.title, episode[2].trim())
    : null;

  if (!seriesLink || !episode?.[1] || !episode[2] || !season) return null;

  const seriesUrl = new URL(seriesLink.getAttribute('href') ?? seriesLink.href, url.origin);
  const series = SERIES_PATH.exec(seriesUrl.pathname);
  const seriesTitle = seriesLink.textContent?.trim();
  if (!series?.[1] || !seriesTitle) return null;

  return {
    seriesId: series[1],
    seriesTitle,
    seriesUrl: `${seriesUrl.origin}${seriesUrl.pathname}`,
    seasonNumber: season,
    episodeNumber: episode[1],
    episodeTitle: episode[2].trim(),
    episodeId: watch.episodeId,
    watchUrl: `${url.origin}${url.pathname}`,
    updatedAt,
  };
}
