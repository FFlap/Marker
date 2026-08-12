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

export const isEpisodeReleased = (episode: EpisodeAvailability, now = Date.now()) => {
  const today = new Date(now).toISOString().slice(0, 10);
  const airDate = episode.airDate?.trim();
  if (airDate && ISO_DATE.test(airDate)) return airDate <= today;
  return !(genericEpisodeName(episode) && !episode.overview?.trim() && !episode.imageUrl?.trim());
};

export const releasedEpisodes = <Episode extends EpisodeAvailability>(
  episodes: Episode[],
  now = Date.now(),
) => episodes.filter((episode) => isEpisodeReleased(episode, now));
