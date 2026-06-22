export interface EpisodeBookmark {
  seriesId: string;
  seriesTitle: string;
  seriesUrl: string;
  seasonNumber: string;
  episodeNumber: string;
  episodeTitle: string;
  episodeId: string;
  watchUrl: string;
  updatedAt: number;
}

export interface BookmarkStore {
  version: 1;
  bookmarks: Record<string, EpisodeBookmark>;
}

