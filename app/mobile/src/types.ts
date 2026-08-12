import type { Doc } from '../convex/_generated/dataModel';
export type LibraryItem = Doc<'items'>;
export type Status = LibraryItem['status'];
export type SearchResult = {
  id: number;
  title: string;
  mediaType: 'movie' | 'tv';
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  voteAverage?: number;
};
