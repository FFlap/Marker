export type WebLibraryItem = {
  _id: string;
  title: string;
  status: "watched" | "watching" | "watchlist" | "dropped";
  mediaType: "movie" | "tv";
  rating?: number;
  rank: number;
  tags: string[];
  posterPath?: string;
  releaseDate?: string;
  overview?: string;
  isAnime?: boolean;
  genres?: string[];
  runtime?: number;
  timesWatched?: number;
  tmdbId?: number;
};
