import { Effect } from 'effect';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { runActionEffect } from './actionEffects';
import { isTruncatedSnapshot, putNonFatal, SNAPSHOT_TTL_MS } from './providerSnapshots';
import type { AnimeEpisode } from './tvdbParsing';

type Ctx = Pick<ActionCtx, 'runQuery' | 'runMutation'>;
const keyFor = (id: number, order: string) => `tvdb:catalog:v1:${id}:${order}:eng`;
const CHUNK_SIZE = 120;
const MAX_CHUNKS = 500;
const CHUNK_CONCURRENCY = 8;

/** A manifest is published only after every immutable generation chunk is durable. */
export async function reusableCatalog(
  ctx: Ctx,
  id: number,
  order: string,
  load: () => Promise<AnimeEpisode[]>,
  force = false,
): Promise<AnimeEpisode[]> {
  const key = keyFor(id, order);
  const startedAt = Date.now();
  const prior = force ? await ctx.runQuery(internal.providerSnapshots.get, { key }) : null;
  const priorGeneration = prior?.kind === 'tvdbCatalog' ? prior.value.generation : undefined;
  const read = async () => {
    const stored = await ctx.runQuery(internal.providerSnapshots.get, { key });
    if (
      !stored ||
      stored.kind !== 'tvdbCatalog' ||
      stored.refreshedAt <= startedAt - SNAPSHOT_TTL_MS ||
      (force && (stored.refreshedAt < startedAt || stored.value.generation === priorGeneration))
    )
      return null;
    const manifest = stored.value;
    if (manifest.chunks > MAX_CHUNKS) return null;
    const episodes: AnimeEpisode[] = [];
    for (let start = 0; start < manifest.chunks; start += CHUNK_CONCURRENCY) {
      const chunks = await Promise.all(
        Array.from({ length: Math.min(CHUNK_CONCURRENCY, manifest.chunks - start) }, (_, offset) =>
          ctx.runQuery(internal.providerSnapshots.get, {
            key: `tvdb:season:catalog:${manifest.generation}:${start + offset}`,
          }),
        ),
      );
      for (const chunk of chunks) {
        if (!chunk || chunk.kind !== 'episodes' || isTruncatedSnapshot(chunk.value)) return null;
        episodes.push(...(chunk.value as AnimeEpisode[]));
      }
    }
    return episodes.length === manifest.count ? episodes : null;
  };
  const fresh = await read();
  if (fresh) return fresh;
  const token = crypto.randomUUID();
  const deadline = Date.now() + 65_000;
  while (
    !(await ctx.runMutation(internal.resolvedMetadata.requests.claimRefresh, {
      key,
      token,
      leaseMs: 60_000,
    }))
  ) {
    if (Date.now() >= deadline) throw new Error('TVDB catalog refresh in progress');
    await runActionEffect(Effect.sleep(100));
    const completed = await read();
    if (completed) return completed;
  }
  try {
    // Another holder may have published between our read and lease claim.
    const completed = await read();
    if (completed) return completed;
    const episodes = await load();
    const chunks = Math.ceil(episodes.length / CHUNK_SIZE);
    if (chunks > MAX_CHUNKS) throw new Error('TVDB catalog exceeded the storage limit');
    for (let start = 0; start < chunks; start += CHUNK_CONCURRENCY) {
      const saved = await Promise.all(
        Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks - start) }, (_, offset) => {
          const index = start + offset;
          return putNonFatal(ctx, {
            key: `tvdb:season:catalog:${token}:${index}`,
            value: episodes.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
            metricKey: 'tvdb-catalog-chunk',
          });
        }),
      );
      if (saved.some((value) => !value)) throw new Error('TVDB catalog chunk was not persisted');
    }
    const published = await ctx.runMutation(internal.providerSnapshots.publishCatalog, {
      key,
      token,
      value: { generation: token, chunks, count: episodes.length },
    });
    if (!published) throw new Error('TVDB catalog refresh superseded');
    return episodes;
  } finally {
    await ctx.runMutation(internal.resolvedMetadata.requests.releaseRefresh, { key, token });
  }
}
