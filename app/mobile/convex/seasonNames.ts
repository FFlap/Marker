export type SeasonSummary = {
  season: number;
  name: string;
  episodeCount: number;
};

const genericSeasonLabel = (name: string) => {
  const normalized = name.normalize('NFKC').trim().toLocaleLowerCase();
  const word = '(?:season|series|temporada|saison|staffel|seizoen|stagione)';
  return (
    new RegExp(`^${word}\\s*#?\\s*\\d+$`, 'iu').test(normalized) ||
    new RegExp(`^\\d+\\s*\\.?\\s*${word}$`, 'iu').test(normalized)
  );
};

const usableEnglishLabel = (name: string) =>
  name.trim().length > 0 && !genericSeasonLabel(name) && /\p{Script=Latin}/u.test(name);

/**
 * TVDB remains authoritative for season coordinates and counts. When its
 * English label is missing, generic, or only available in another script,
 * reuse the matching TMDB display name without changing the selected order.
 */
export const mergeSeasonDisplayNames = (
  tvdbSeasons: SeasonSummary[],
  tmdbSeasons: SeasonSummary[],
) => {
  const tmdbBySeason = new Map(tmdbSeasons.map((season) => [season.season, season]));
  return tvdbSeasons.map((season) => {
    if (usableEnglishLabel(season.name)) return season;
    const fallback = tmdbBySeason.get(season.season);
    return fallback && usableEnglishLabel(fallback.name)
      ? { ...season, name: fallback.name }
      : season;
  });
};

export const hideResolvedEmptySeasons = (
  seasons: SeasonSummary[],
  resolvedEpisodeCounts: { season: number; episodeCount: number }[],
) => {
  const empty = new Set(
    resolvedEpisodeCounts
      .filter((season) => season.episodeCount === 0)
      .map((season) => season.season),
  );
  return seasons.filter((season) => !empty.has(season.season));
};
