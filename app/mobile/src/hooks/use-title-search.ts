import { runClientEffect } from '@marker/shared/clientOperations';
import * as Effect from 'effect/Effect';
import { searchTitles } from '@marker/shared/clientEffects';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '@marker/shared/api';
import type { SearchResult } from '@/types';

type SearchResponse =
  | { state: 'succeeded'; query: string; results: SearchResult[] }
  | { state: 'failed'; query: string; results: SearchResult[] };
const EMPTY_RESULTS: SearchResult[] = [];
/** Only one query's results are kept (one per category); older queries search again. */
const ofQuery = (responses: Record<string, SearchResponse>, query: string) =>
  Object.fromEntries(Object.entries(responses).filter(([, entry]) => entry.query === query));

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
  const search = useAction(api.tmdb.searchMulti);
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
    return searchTitles(() => search({ query: searchQuery, ...(type && { type }) })).pipe(
      Effect.match({
        onSuccess: (results) =>
          setResponses((current) => ({
            ...ofQuery(current, searchQuery),
            [key]: { state: 'succeeded', query: searchQuery, results },
          })),
        // Shown inline by the screen ("Search isn’t available" with Try again).
        onFailure: () =>
          setResponses((current) => ({
            ...ofQuery(current, searchQuery),
            [key]: { state: 'failed', query: searchQuery, results: [] },
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
  return {
    debouncedQuery,
    ready,
    settled,
    results: response ? response.results : EMPTY_RESULTS,
    loading: enabled && ready && !response,
    /** The search for this query failed (not "no matches"), so offer to try again. */
    failed: response?.state === 'failed',
    retry: () => {
      setResponses(({ [keyOf(normalizedQuery)]: _failed, ...rest }) => rest);
      setAttempt((value) => value + 1);
    },
  };
}
