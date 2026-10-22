import { type Infer, v } from 'convex/values';
export const CALENDAR_TTL_MS = 6 * 60 * 60 * 1000;
export const candidateValidator = v.object({
  tmdbId: v.number(),
  mediaType: v.union(v.literal('movie'), v.literal('tv')),
});
export const libraryTitleValidator = v.object({
  ...candidateValidator.fields,
  title: v.string(),
  posterPath: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  status: v.union(v.literal('watched'), v.literal('watching'), v.literal('watchlist')),
});
export const releaseValidator = v.object({
  id: v.string(),
  date: v.string(),
  kind: v.union(v.literal('movie'), v.literal('episode')),
  season: v.optional(v.number()),
  episode: v.optional(v.number()),
  episodeName: v.optional(v.string()),
});
export const eventValidator = v.object({
  ...libraryTitleValidator.fields,
  ...releaseValidator.fields,
});
export const catalogRegion = (region: string, mediaType: 'movie' | 'tv') =>
  mediaType === 'tv' ? 'tv' : `movie:${region}`;
export const dateCursorValidator = v.object({
  mediaType: v.optional(v.union(v.literal('movie'), v.literal('tv'))),
  month: v.string(),
  offset: v.number(),
  releaseOffset: v.optional(v.number()),
  releaseVersion: v.optional(v.string()),
  version: v.string(),
});
export type LibraryTitle = Infer<typeof libraryTitleValidator>;
export type CalendarEvent = Infer<typeof eventValidator>;
type Candidate = Infer<typeof candidateValidator>;
export const scheduleKey = (
  month: string,
  region: string,
  item: Candidate & { releaseDate?: string },
) =>
  `${region}:${month}:${item.mediaType}:${item.tmdbId}:${item.mediaType === 'movie' ? (item.releaseDate ?? '') : ''}`;
export const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
};
export const isDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};
export const inRange = (date: string, startDate: string, endDate: string) =>
  date >= startDate && date <= endDate;
