import { useEffect, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useToast } from '@/components/ui/Toast';
import type { SearchResult } from '@/types';

type SearchResponse = { query: string; results: SearchResult[]; failed?: boolean };
const EMPTY_RESULTS: SearchResult[] = [];

/** Shares one query lifecycle across title search screens and local media filters. */
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
    const timer = setTimeout(() => setDebouncedQuery(normalizedQuery), delayMs);
    return () => clearTimeout(timer);
  }, [normalizedQuery, delayMs]);

  useEffect(() => {
    if (!enabled || !ready || !settled || response?.query === normalizedQuery) return;
    let active = true;
    void search({ query: normalizedQuery })
      .then((results) => {
        if (!active) return;
        setResponse({ query: normalizedQuery, results });
      })
      .catch(() => {
        if (!active) return;
        setResponse({ query: normalizedQuery, results: [], failed: true });
        show('Search is unavailable right now');
      });
    return () => {
      active = false;
    };
  }, [enabled, normalizedQuery, ready, response, search, settled, show]);

  const current = enabled && ready && response?.query === normalizedQuery;
  return {
    normalizedQuery,
    debouncedQuery,
    ready,
    settled,
    results: current ? response.results : EMPTY_RESULTS,
    loading: enabled && ready && !current,
  };
}
