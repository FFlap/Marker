import {
  records,
  selectSeriesMatch,
  seriesId,
  verifiedTmdbRemoteSeries,
  type Json,
} from './tvdbParsing';

/** Search indexes may still contain deleted series. Exclude only confirmed deletions. */
export async function findSeries(
  request: (path: string) => Promise<Json>,
  tmdbId: number,
  titles: string[],
  excluded: ReadonlySet<number>,
) {
  try {
    const remote = await request(`/search/remoteid/${encodeURIComponent(String(tmdbId))}`);
    const remoteIds = new Set(
      records(remote.data)
        .map((entry) => verifiedTmdbRemoteSeries(entry, titles))
        .filter((id): id is number => id !== undefined && id > 0 && !excluded.has(id)),
    );
    if (remoteIds.size > 1) return undefined;
    if (remoteIds.size === 1) return remoteIds.values().next().value;
  } catch {
    // Some numeric remote IDs are ambiguous across providers; title search verifies the fallback.
  }
  for (const title of titles) {
    const search = await request(`/search?query=${encodeURIComponent(title)}&type=series&limit=20`);
    const candidates = records(search.data).filter((entry) => {
      const id = seriesId(entry);
      return id !== undefined && !excluded.has(id);
    });
    const exact = selectSeriesMatch(candidates, tmdbId, titles);
    const id = seriesId(exact ?? {});
    if (id) return id;
  }
  return undefined;
}
