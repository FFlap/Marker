import { Effect } from 'effect';
import { providerOutcome } from './actionEffects';
import {
  records,
  selectSeriesMatch,
  seriesId,
  verifiedTmdbRemoteSeries,
  type Json,
} from './tvdbParsing';

/** Search indexes may still contain deleted series. Exclude only confirmed deletions. */
export const findSeriesEffect = Effect.fnUntraced(function* <E>(
  request: (path: string) => Effect.Effect<Json, E>,
  tmdbId: number,
  titles: string[],
  excluded: ReadonlySet<number>,
) {
  const remoteResult = yield* providerOutcome(
    request(`/search/remoteid/${encodeURIComponent(String(tmdbId))}`),
  );
  if (remoteResult.ok) {
    const remote = remoteResult.value;
    const remoteIds = new Set(
      records(remote.data)
        .map((entry) => verifiedTmdbRemoteSeries(entry, titles))
        .filter((id): id is number => id !== undefined && id > 0 && !excluded.has(id)),
    );
    if (remoteIds.size > 1) return undefined;
    if (remoteIds.size === 1) return remoteIds.values().next().value;
  }
  // Expected remote lookup failures permit title search; defects and interruption propagate.
  for (const title of titles) {
    const search = yield* request(
      `/search?query=${encodeURIComponent(title)}&type=series&limit=20`,
    );
    const candidates = records(search.data).filter((entry) => {
      const id = seriesId(entry);
      return id !== undefined && !excluded.has(id);
    });
    const exact = selectSeriesMatch(candidates, tmdbId, titles);
    const id = seriesId(exact ?? {});
    if (id) return id;
  }
  return undefined;
});

/** Compatibility edge for native callers; provider orchestration uses findSeriesEffect. */
export function findSeries(
  request: (path: string) => Promise<Json>,
  tmdbId: number,
  titles: string[],
  excluded: ReadonlySet<number>,
) {
  return Effect.runPromise(
    findSeriesEffect(
      (path) => Effect.tryPromise({ try: () => request(path), catch: (error) => error }),
      tmdbId,
      titles,
      excluded,
    ),
  );
}
