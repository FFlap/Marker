import { transitionAsync, type AsyncState } from "@marker/shared/lifecycle";
import { runClientEffect } from "@marker/shared/clientOperations";
import { Effect } from "effect";
import { searchTitles } from "@marker/shared/clientEffects";
import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@marker/shared/api";
import { TITLE_SEARCH_MAX_LENGTH, type SearchResult } from "@/lib/catalog";

type SearchState = {
  query: string;
  request: AsyncState<SearchResult[]>;
};

export function useTitleSearch(query: string, enabled = true) {
  const search = useAction(api.tmdb.searchMulti);
  const normalized = query.trim();
  const activeQuery =
    enabled &&
    normalized.length >= 2 &&
    normalized.length <= TITLE_SEARCH_MAX_LENGTH
      ? normalized
      : "";
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const [state, setState] = useState<SearchState>({
    query: "",
    request: { state: "idle" },
  });

  useEffect(() => {
    if (!activeQuery) return undefined;
    const controller = new AbortController();
    setState({
      query: activeQuery,
      request: { state: "pending", version: attempt },
    });
    void runClientEffect(
      searchTitles(() => search({ query: activeQuery })).pipe(
        Effect.match({
          onSuccess: (results) =>
            setState((current) => ({
              query: activeQuery,
              request: transitionAsync(current.request, {
                type: "succeed",
                version: attempt,
                value: results,
              }),
            })),
          onFailure: () =>
            setState((current) => ({
              query: activeQuery,
              request: transitionAsync(current.request, {
                type: "fail",
                version: attempt,
                error: "Search is unavailable right now.",
              }),
            })),
        }),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [activeQuery, attempt, search]);

  if (enabled && normalized.length > TITLE_SEARCH_MAX_LENGTH)
    return {
      retry,
      results: [],
      loading: false,
      error: `Search must be ${TITLE_SEARCH_MAX_LENGTH} characters or fewer.`,
    };
  if (!activeQuery) return { retry, results: [], loading: false, error: "" };
  if (state.query !== activeQuery)
    return { retry, results: [], loading: true, error: "" };
  return {
    retry,
    results: state.request.state === "succeeded" ? state.request.value : [],
    loading: state.request.state === "pending",
    error: state.request.state === "failed" ? state.request.error : "",
  };
}
