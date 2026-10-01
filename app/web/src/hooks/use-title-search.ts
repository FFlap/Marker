import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { TITLE_SEARCH_MAX_LENGTH, type SearchResult } from "@/lib/catalog";

type SearchState = {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string;
};

export function useTitleSearch(query: string, enabled = true) {
  const search = useAction(api.tmdb.searchMulti);
  const normalized = query.trim();
  const activeQuery =
    enabled && normalized.length >= 2 && normalized.length <= TITLE_SEARCH_MAX_LENGTH
      ? normalized
      : "";
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const [state, setState] = useState<SearchState>({
    query: "", results: [], loading: false, error: "",
  });

  useEffect(() => {
    if (!activeQuery) return undefined;
    let active = true;
    setState({ query: activeQuery, results: [], loading: true, error: "" });
    void search({ query: activeQuery }).then(
      (results) => {
        if (active)
          setState({ query: activeQuery, results, loading: false, error: "" });
        return undefined;
      },
      () => {
        if (active)
          setState({
            query: activeQuery,
            results: [],
            loading: false,
            error: "Search is unavailable right now.",
          });
        return undefined;
      },
    );
    return () => { active = false; };
  }, [activeQuery, attempt, search]);

  if (enabled && normalized.length > TITLE_SEARCH_MAX_LENGTH)
    return {
      retry, results: [], loading: false,
      error: `Search must be ${TITLE_SEARCH_MAX_LENGTH} characters or fewer.`,
    };
  if (!activeQuery) return { retry, results: [], loading: false, error: "" };
  if (state.query !== activeQuery)
    return { retry, results: [], loading: true, error: "" };
  return { ...state, retry };
}
