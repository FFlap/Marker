import { v, type Infer } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import {
  releaseValidator,
  libraryTitleValidator,
  eventValidator,
  scheduleKey,
} from './calendarTypes';

export const RELEASE_PAGE_SIZE = 500;
const CHUNK_SIZE = 250;
const writeArgs = {
  key: v.string(),
  month: v.string(),
  token: v.string(),
  refreshedAt: v.number(),
};

export const begin = internalMutation({
  args: writeArgs,
  returns: v.boolean(),
  handler: async (ctx, { key, month, token, refreshedAt }) => {
    const row = await ctx.db
      .query('calendarSchedules')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (row && Math.max(row.refreshedAt, row.stagingRefreshedAt ?? 0) > refreshedAt) return false;
    if (row?.stagingVersion && row.stagingVersion !== token)
      await ctx.scheduler.runAfter(0, internal.calendarScheduleStore.discardVersion, {
        key,
        version: row.stagingVersion,
      });
    const staging = { stagingVersion: token, stagingNextChunk: 0, stagingRefreshedAt: refreshedAt };
    if (row) await ctx.db.patch(row._id, staging);
    else
      await ctx.db.insert('calendarSchedules', {
        key,
        month,
        events: [],
        refreshedAt: 0,
        ...staging,
      });
    return true;
  },
});
export const writeChunk = internalMutation({
  args: { ...writeArgs, chunk: v.number(), events: v.array(releaseValidator), done: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, { key, month, token, refreshedAt, chunk, events, done }) => {
    if (events.length > CHUNK_SIZE || (!done && events.length !== CHUNK_SIZE))
      throw new Error('Invalid release chunk');
    const row = await ctx.db
      .query('calendarSchedules')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (
      !row ||
      row.stagingVersion !== token ||
      row.stagingNextChunk !== chunk ||
      row.stagingRefreshedAt !== refreshedAt
    )
      return false;
    await ctx.db.insert('calendarReleaseChunks', { key, month, version: token, chunk, events });
    await ctx.db.patch(
      row._id,
      done
        ? {
            version: token,
            events: [],
            eventCount: chunk * CHUNK_SIZE + events.length,
            refreshedAt,
            stagingVersion: undefined,
            stagingNextChunk: undefined,
            stagingRefreshedAt: undefined,
          }
        : { stagingNextChunk: chunk + 1 },
    );
    if (done && row.version)
      await ctx.scheduler.runAfter(0, internal.calendarScheduleStore.discardVersion, {
        key,
        version: row.version,
      });
    return true;
  },
});
export const discardVersion = internalMutation({
  args: { key: v.string(), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('calendarReleaseChunks')
      .withIndex('by_key_version_chunk', (q) => q.eq('key', args.key).eq('version', args.version))
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 100)
      await ctx.scheduler.runAfter(0, internal.calendarScheduleStore.discardVersion, args);
    return null;
  },
});

async function read(ctx: QueryCtx, key: string, offset: number, limit: number) {
  const row = await ctx.db
    .query('calendarSchedules')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
  if (!row) return { events: [], count: 0, version: '' };
  const count = row.eventCount ?? row.events.length;
  const version = row.version ?? `${row._id}:${row.refreshedAt}`;
  if (limit <= 0 || offset >= count) return { events: [], count, version };
  if (!row.version) return { events: row.events.slice(offset, offset + limit), count, version };
  const chunks = await ctx.db
    .query('calendarReleaseChunks')
    .withIndex('by_key_version_chunk', (q) =>
      q
        .eq('key', key)
        .eq('version', row.version!)
        .gte('chunk', Math.floor(offset / CHUNK_SIZE)),
    )
    .take(Math.ceil(limit / CHUNK_SIZE) + 1);
  return {
    events: chunks
      .flatMap((chunk) => chunk.events)
      .slice(offset % CHUNK_SIZE, (offset % CHUNK_SIZE) + limit),
    count,
    version,
  };
}
export const readPage = internalQuery({
  args: { key: v.string(), offset: v.number() },
  returns: v.object({ events: v.array(releaseValidator), count: v.number(), version: v.string() }),
  handler: (ctx, { key, offset }) => read(ctx, key, offset, RELEASE_PAGE_SIZE),
});
export const releases = internalQuery({
  args: {
    month: v.string(),
    region: v.string(),
    items: v.array(libraryTitleValidator),
    offset: v.number(),
    version: v.optional(v.string()),
  },
  returns: v.object({
    events: v.array(eventValidator),
    nextOffset: v.union(v.number(), v.null()),
    version: v.string(),
  }),
  handler: async (ctx, { month, region, items, offset, version }) => {
    if (!Number.isInteger(offset) || offset < 0 || items.length > 100)
      throw new Error('Invalid release cursor');
    const events: Infer<typeof eventValidator>[] = [];
    let skip = offset;
    let hasMore = false;
    const generations: string[] = [];
    for (const item of items) {
      const saved = await read(
        ctx,
        scheduleKey(month, region, item),
        skip,
        RELEASE_PAGE_SIZE - events.length,
      );
      generations.push(JSON.stringify([scheduleKey(month, region, item), saved.version]));
      if (skip >= saved.count) {
        skip -= saved.count;
        continue;
      }
      events.push(...saved.events.map((event) => ({ ...item, ...event })));
      if (skip + saved.events.length < saved.count) hasMore = true;
      skip = 0;
    }
    const currentVersion = JSON.stringify(generations);
    if (version !== undefined && version !== currentVersion)
      throw new Error('Release dates changed. Please retry the calendar.');
    return { events, nextOffset: hasMore ? offset + events.length : null, version: currentVersion };
  },
});

export async function readAll(ctx: ActionCtx, key: string) {
  const events: Infer<typeof releaseValidator>[] = [];
  let offset = 0;
  let version: string | undefined;
  while (true) {
    const page = await ctx.runQuery(internal.calendarScheduleStore.readPage, { key, offset });
    if (version !== undefined && version !== page.version)
      throw new Error('Release dates changed. Please retry the calendar.');
    version = page.version;
    events.push(...page.events);
    offset += page.events.length;
    if (offset >= page.count || !page.events.length) return events;
  }
}
export async function save(
  ctx: ActionCtx,
  key: string,
  month: string,
  refreshedAt: number,
  events: Infer<typeof releaseValidator>[],
) {
  const args = { key, month, refreshedAt, token: crypto.randomUUID() };
  if (!(await ctx.runMutation(internal.calendarScheduleStore.begin, args))) return;
  for (let offset = 0; offset < Math.max(1, events.length); offset += CHUNK_SIZE)
    if (
      !(await ctx.runMutation(internal.calendarScheduleStore.writeChunk, {
        ...args,
        chunk: offset / CHUNK_SIZE,
        events: events.slice(offset, offset + CHUNK_SIZE),
        done: offset + CHUNK_SIZE >= events.length,
      }))
    )
      return;
}
