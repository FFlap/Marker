import { runClientEffect } from '@marker/shared/clientOperations';
import * as Effect from 'effect/Effect';
import { searchTitles } from '@marker/shared/clientEffects';
import { useEffect, useEffectEvent, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '@marker/shared/api';
import { useToast } from '@/components/ui/Toast';
import type { SearchResult } from '@/types';

type SearchResponse = { query: string; results: SearchResult[]; failed?: boolean };
const EMPTY_RESULTS: SearchResult[] = [];

export function useTitleSearch(
  query: string,
  { enabled = true, delayMs = 300 }: { enabled?: boolean; delayMs?: number } = {},
) {
  const search = useAction(api.tmdb.searchMulti);
  const { show } = useToast();
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse>();
  const ready = normalizedQuery.length >= 2;
  const settled = normalizedQuery === debouncedQuery;
  const runSearch = useEffectEvent((searchQuery: string) => {
    if (!enabled || searchQuery.length < 2 || (response?.query === searchQuery && !response.failed))
      return Effect.void;
    setResponse(undefined);
    return searchTitles(() => search({ query: searchQuery })).pipe(
      Effect.match({
        onSuccess: (results) => setResponse({ query: searchQuery, results }),
        onFailure: () => {
          setResponse({ query: searchQuery, results: [], failed: true });
          show('Search is unavailable right now');
        },
      }),
    );
  });

  useEffect(() => {
    // A query change cancels both the debounce and any obsolete request.
    const controller = new AbortController();
    void runClientEffect(
      Effect.sleep(delayMs).pipe(
        Effect.andThen(Effect.sync(() => setDebouncedQuery(normalizedQuery))),
        Effect.andThen(() => runSearch(normalizedQuery)),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [normalizedQuery, delayMs, enabled]);

  const current = enabled && ready && response?.query === normalizedQuery;
  return {
    debouncedQuery,
    ready,
    settled,
    results: current ? response.results : EMPTY_RESULTS,
    loading: enabled && ready && !current,
  };
}
