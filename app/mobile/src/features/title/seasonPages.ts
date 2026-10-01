type SeasonPage = {
  season: number;
  metadataProvider: string;
  orderEpoch: number;
  seasonVersion?: string;
  totalCount: number;
  chunkIndex: number;
};

/** A reactive refresh may briefly include old pages or restart a cursor at chunk zero. */
export function currentSeasonPages<T extends SeasonPage>(
  results: readonly T[],
  season: number | undefined,
): T[] {
  const first = results.find((page) => page.season === season && page.chunkIndex === 0);
  if (!first) return [];
  const byChunk = new Map<number, T>();
  for (const page of results) {
    if (
      page.season === season &&
      page.metadataProvider === first.metadataProvider &&
      page.orderEpoch === first.orderEpoch &&
      page.seasonVersion === first.seasonVersion &&
      page.totalCount === first.totalCount &&
      !byChunk.has(page.chunkIndex)
    ) {
      byChunk.set(page.chunkIndex, page);
    }
  }
  const pages: T[] = [];
  for (let index = 0; byChunk.has(index); index += 1) pages.push(byChunk.get(index)!);
  return pages;
}
