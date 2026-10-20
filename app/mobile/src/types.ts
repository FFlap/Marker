import type { Doc } from '@marker/shared/dataModel';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@marker/shared/api';
export type LibraryItem = Doc<'items'>;
export type Status = LibraryItem['status'];
export type SearchResult = FunctionReturnType<typeof api.tmdb.searchMulti>[number];
