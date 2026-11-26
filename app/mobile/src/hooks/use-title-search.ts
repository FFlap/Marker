import { runClientEffect } from '@marker/shared/clientOperations';
import * as Effect from 'effect/Effect';
import { searchTitles } from '@marker/shared/clientEffects';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '@marker/shared/api';
import type { SearchResult } from '@/types';

type SearchResponse = {
  state: 'succeeded' | 'failed';
  query: string;
  results: SearchResult[];
  /** A category search has a later page ("Load more"). */
  hasMore: boolean;
  page: number;
};
const EMPTY_RESULTS: SearchResult[] = [];
/** Only one query's results are kept (one per category); older queries search again. */
const ofQuery = (responses: Record<string, SearchResponse>, query: string) =>
  Object.fromEntries(Object.entries(responses).filter(([, entry]) => entry.query === query));
const resultKey = (result: SearchResult) => `${result.mediaType}:${result.id}`;
const without = (keys: ReadonlySet<string>, key: string) => {
  if (!keys.has(key)) return keys;
  const next = new Set(keys);
  next.delete(key);
  return next;
};

export function useTitleSearch(
  query: string,
  {
    enabled = true,
    delayMs = 300,
    type,
  }: {
    enabled?: boolean;
    delayMs?: number;
    /** Search only movies or only TV shows (a category's own list), not the mixed page. */
    type?: 'movie' | 'tv';
  } = {},
) {
  const searchAll = useAction(api.tmdb.searchMulti);
  const searchCategory = useAction(api.tmdb.searchCategory);
  // A movies or TV shows list asks for that category's own pages; "all" is the mixed page.
  const request = (searchQuery: string, page: number) =>
    type
      ? searchCategory({ query: searchQuery, type, page })
      : searchAll({ query: searchQuery }).then((results) => ({ results, hasMore: false }));
  // Lists (by category and query) whose next page is loading, or whose last one failed, so
  // each list keeps its own state however the person switches between them.
  const [loadingMoreKeys, setLoadingMoreKeys] = useState<ReadonlySet<string>>(new Set());
  const [failedMoreKeys, setFailedMoreKeys] = useState<ReadonlySet<string>>(new Set());
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Finished searches by kind and query, so switching categories back doesn't search again.
  const [responses, setResponses] = useState<Record<string, SearchResponse>>({});
  // Bumped by "Try again" to search the same query once more.
  const [attempt, setAttempt] = useState(0);
  const ready = normalizedQuery.length >= 2;
  const settled = normalizedQuery === debouncedQuery;
  const keyOf = (searchQuery: string) => `${type ?? 'all'}:${searchQuery}`;
  const runSearch = useEffectEvent((searchQuery: string) => {
    const key = keyOf(searchQuery);
    if (!enabled || searchQuery.length < 2 || responses[key]?.state === 'succeeded')
      return Effect.void;
    setResponses(({ [key]: _stale, ...rest }) => rest);
    return searchTitles(() => request(searchQuery, 1)).pipe(
      Effect.match({
        onSuccess: ({ results, hasMore }) =>
          setResponses((current) => ({
            ...ofQuery(current, searchQuery),
            [key]: { state: 'succeeded', query: searchQuery, results, hasMore, page: 1 },
          })),
        // Shown inline by the screen ("Search isn’t available" with Try again).
        onFailure: () =>
          setResponses((current) => ({
            ...ofQuery(current, searchQuery),
            [key]: { state: 'failed', query: searchQuery, results: [], hasMore: false, page: 1 },
          })),
      }),
    );
  });

  const searchedQuery = useRef('');
  useEffect(() => {
    // A query change cancels both the debounce and any obsolete request. Switching category
    // for the query already searched doesn't wait for the debounce.
    const controller = new AbortController();
    const delay = normalizedQuery === searchedQuery.current ? 0 : delayMs;
    searchedQuery.current = normalizedQuery;
    void runClientEffect(
      Effect.sleep(delay).pipe(
        Effect.andThen(Effect.sync(() => setDebouncedQuery(normalizedQuery))),
        Effect.andThen(() => runSearch(normalizedQuery)),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [normalizedQuery, delayMs, enabled, attempt, type]);

  const response = enabled && ready ? responses[keyOf(normalizedQuery)] : undefined;
  /** The next page of a category list, added below what is shown. */
  const loadingMore = !!response && loadingMoreKeys.has(keyOf(response.query));
  const loadMore = () => {
    if (!response || response.state !== 'succeeded' || !response.hasMore || loadingMore) return;
    const key = keyOf(response.query);
    const next = response.page + 1;
    setLoadingMoreKeys((current) => new Set(current).add(key));
    setFailedMoreKeys((current) => without(current, key));
    void runClientEffect(
      searchTitles(() => request(response.query, next)).pipe(
        Effect.match({
          onSuccess: ({ results, hasMore }) =>
            setResponses((current) => {
              const shown = current[key];
              // Gone (a newer query) or already past this page: nothing to add.
              if (!shown || shown.page !== next - 1) return current;
              const seen = new Set(shown.results.map(resultKey));
              return {
                ...current,
                [key]: {
                  ...shown,
                  results: [...shown.results, ...results.filter((r) => !seen.has(resultKey(r)))],
                  hasMore,
                  page: next,
                },
              };
            }),
          // The list stays as it was, and the button offers to try again.
          onFailure: () => setFailedMoreKeys((current) => new Set(current).add(key)),
        }),
        Effect.ensuring(Effect.sync(() => setLoadingMoreKeys((current) => without(current, key)))),
      ),
    );
  };
  return {
    debouncedQuery,
    ready,
    settled,
    results: response ? response.results : EMPTY_RESULTS,
    loading: enabled && ready && !response,
    /** The search for this query failed (not "no matches"), so offer to try again. */
    failed: response?.state === 'failed',
    hasMore: response?.state === 'succeeded' && response.hasMore,
    loadingMore,
    loadMoreFailed: !!response && failedMoreKeys.has(keyOf(response.query)),
    loadMore,
    retry: () => {
      setResponses(({ [keyOf(normalizedQuery)]: _failed, ...rest }) => rest);
      setAttempt((value) => value + 1);
    },
  };
}
