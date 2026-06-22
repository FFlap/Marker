import type { EpisodeBookmark } from './domain/types';

export const BOOKMARKS_STORAGE_KEY = 'crunchyrollBookmarks';

export interface EpisodeDetectedMessage {
  type: 'EPISODE_DETECTED';
  bookmark: EpisodeBookmark;
}

export type ExtensionMessage = EpisodeDetectedMessage;

