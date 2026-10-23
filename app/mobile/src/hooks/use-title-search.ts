import { runClientEffect } from '@marker/shared/clientOperations';
import { Effect } from 'effect';
import { searchTitles } from '@marker/shared/clientEffects';
import { useEffect, useState } from 'react';
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
  if (response?.failed && response.query !== normalizedQuery) setResponse(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void runClientEffect(
      Effect.sleep(delayMs).pipe(
        Effect.andThen(Effect.sync(() => setDebouncedQuery(normalizedQuery))),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [normalizedQuery, delayMs]);

  useEffect(() => {
    if (!enabled || !ready || !settled || response?.query === normalizedQuery) return;
    const controller = new AbortController();
    void runClientEffect(
      searchTitles(() => search({ query: normalizedQuery })).pipe(
        Effect.match({
          onSuccess: (results) => setResponse({ query: normalizedQuery, results }),
          onFailure: () => {
            setResponse({ query: normalizedQuery, results: [], failed: true });
            show('Search is unavailable right now');
          },
        }),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [enabled, normalizedQuery, ready, response, search, settled, show]);

  const current = enabled && ready && response?.query === normalizedQuery;
  return {
    debouncedQuery,
    ready,
    settled,
    results: current ? response.results : EMPTY_RESULTS,
    loading: enabled && ready && !current,
  };
}
