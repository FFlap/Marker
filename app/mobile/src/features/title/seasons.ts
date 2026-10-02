export type SeasonChoice = {
  season: number;
  name?: string;
  episodeCount: number;
  episodeCountVerified?: boolean;
};

/** Keep picker choices and the metadata requests they produce in the same order. */
export function availableSeasons<T extends SeasonChoice>(seasons: readonly T[] | undefined): T[] {
  return (seasons ?? [])
    .filter(
      (entry) =>
        entry.season >= 0 && (entry.episodeCount > 0 || entry.episodeCountVerified === false),
    )
    .sort((left, right) => left.season - right.season);
}

export function selectAvailableSeason(
  seasons: readonly SeasonChoice[] | undefined,
  selectedSeason: number,
) {
  if (seasons === undefined) return selectedSeason;
  const available = availableSeasons(seasons);
  return available.some((entry) => entry.season === selectedSeason)
    ? selectedSeason
    : (available.find((entry) => entry.season > 0)?.season ?? available[0]?.season ?? 1);
}
