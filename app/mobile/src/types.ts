import type { Doc } from '../convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../convex/_generated/api';
export type LibraryItem = Doc<'items'>;
export type Status = LibraryItem['status'];
export type SearchResult = FunctionReturnType<typeof api.tmdb.searchMulti>[number];
