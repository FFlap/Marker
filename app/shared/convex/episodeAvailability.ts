type EpisodeAvailability = {
  episode: number;
  name: string;
  airDate?: string;
  overview?: string;
  imageUrl?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const genericEpisodeName = (episode: EpisodeAvailability) =>
  new RegExp(`^episode\\s+0*${episode.episode}$`, 'i').test(episode.name.trim());

export const isEpisodeReleased = (episode: EpisodeAvailability, now = Date.now()) =>
  isEpisodeReleasedOn(episode, new Date(now).toISOString().slice(0, 10));

/** Released by `today` (YYYY-MM-DD): a dated episode by its date, an undated one by its details. */
export const isEpisodeReleasedOn = (episode: EpisodeAvailability, today: string) => {
  const airDate = episode.airDate?.trim();
  if (airDate && ISO_DATE.test(airDate)) return airDate <= today;
  return !(genericEpisodeName(episode) && !episode.overview?.trim() && !episode.imageUrl?.trim());
};

/**
 * A dated episode that hasn't aired by `today`, the viewer's local date (the same day the app
 * uses for Up next). An undated episode counts as aired.
 */
export const airsAfter = (airDate: string | undefined, today: string) => {
  const date = airDate?.trim();
  return !!date && ISO_DATE.test(date) && date > today;
};

export const releasedEpisodes = <Episode extends EpisodeAvailability>(
  episodes: Episode[],
  now = Date.now(),
) => episodes.filter((episode) => isEpisodeReleased(episode, now));
