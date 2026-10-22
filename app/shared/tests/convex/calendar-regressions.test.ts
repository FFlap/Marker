import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { loadCalendarPages } from '../../lib/calendar';
import type { Id } from '../../convex/_generated/dataModel';

const modules = import.meta.glob('../../convex/**/*.ts');
const now = Date.UTC(2026, 9, 12);
const window = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'CA' };
const job = { month: '2026-10', region: 'tv', token: 'worker' };
const release = (episode: number, season = 1, date = '2026-10-12') => ({
  id: `episode:1:${season}:${episode}:${date}`,
  date,
  kind: 'episode' as const,
  season,
  episode,
});
const item = (userId: Id<'users'>, tmdbId: number) => ({
  userId,
  tmdbId,
  mediaType: 'tv' as const,
  title: `Show ${tmdbId}`,
  normalizedTitle: `show ${tmdbId}`,
  status: 'watching' as const,
  isAnime: false,
  timesWatched: 0,
  tags: [],
  rank: tmdbId,
  createdAt: 1,
  updatedAt: 1,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture(count = 1) {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'regression' });
    for (let id = 1; id <= count; id++) await ctx.db.insert('items', item(userId, id));
    return userId;
  });
  return { t, userId, asUser: t.withIdentity({ subject: 'regression' }) };
}
async function seedCatalog(t: ReturnType<typeof convexTest>, count = 1) {
  await t.run((ctx) =>
    ctx.db.insert('calendarMonths', {
      month: job.month,
      region: job.region,
      version: 'ready',
      refreshedAt: now,
      candidates: Array.from({ length: count }, (_, i) => ({
        tmdbId: i + 1,
        mediaType: 'tv' as const,
      })),
    }),
  );
}
async function write(
  t: ReturnType<typeof convexTest>,
  events: ReturnType<typeof release>[],
  token = 'schedule',
) {
  const args = { key: 'CA:2026-10:tv:1:', month: job.month, token, refreshedAt: Date.now() };
  await t.mutation(internal.calendarScheduleStore.begin, args);
  for (let offset = 0; offset < Math.max(1, events.length); offset += 250)
    await t.mutation(internal.calendarScheduleStore.writeChunk, {
      ...args,
      chunk: offset / 250,
      events: events.slice(offset, offset + 250),
      done: offset + 250 >= events.length,
    });
}

describe('resumable calendar discovery', () => {
  it('does no provider work on the cold request and durably enqueues discovery', async () => {
    const { t, asUser } = await fixture(21);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await asUser.action(api.calendar.upcoming, window)).toMatchObject({
      refreshPending: true,
      retryAfterMs: 1000,
    });
    expect(fetch).not.toHaveBeenCalled();
    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    expect(scheduled.map((fn) => fn.name)).toEqual(
      expect.arrayContaining(['calendarDiscovery:continueDiscovery', 'calendarRefresh:recover']),
    );
  });
  it('resumes page 301 after the shared budget resets without skipping or replaying pages', async () => {
    const { t, userId } = await fixture(21);
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const page = Number(new URL(input).searchParams.get('page'));
        requested.push(page);
        return new Response(
          JSON.stringify({
            total_pages: 301,
            results: [{ id: page }],
          }),
        );
      }),
    );
    await t.mutation(internal.calendarCatalog.claim, job);
    for (let page = 1; page <= 301; page++)
      await t.action(internal.calendarDiscovery.continueDiscovery, job);
    expect(requested).toHaveLength(300);
    expect(await t.query(internal.calendarRefresh.progress, job)).toEqual({ feed: 0, page: 301 });
    expect(
      await t.query(internal.calendarCatalog.metadata, { month: job.month, region: job.region }),
    ).toMatchObject({ version: '' });
    vi.setSystemTime(now + 60_001);
    await t.action(internal.calendarDiscovery.continueDiscovery, job);
    expect(requested).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
    expect(await t.run((ctx) => ctx.db.query('calendarMonths').first())).toMatchObject({
      candidateCount: 301,
      candidates: [],
      version: 'worker',
    });
    expect(await t.query(internal.calendarRefresh.progress, job)).toBeNull();
    await t.run((ctx) => ctx.db.insert('items', item(userId, 301)));
    const tail = await t.query(internal.calendarCatalog.page, {
      month: job.month,
      region: 'CA',
      userId,
      mediaType: 'tv',
      offset: 300,
    });
    expect(tail.titles.map((entry) => entry.item.tmdbId)).toEqual([301]);
    expect(tail.nextOffset).toBeNull();
  }, 15_000);
  it('publishes and pages over 8192 candidates from a durable checkpoint', async () => {
    const { t, userId } = await fixture(21);
    await t.mutation(internal.calendarCatalog.claim, job);
    // convex-test scans the table for indexed lookups. Seed completed pages directly
    // so this storage-boundary test does not repeat quadratic deduplication work.
    for (let offset = 0; offset < 9000; offset += 1000)
      await t.run(async (ctx) => {
        for (let ordinal = offset; ordinal < offset + 1000; ordinal++)
          await ctx.db.insert('calendarCandidates', {
            month: job.month,
            region: job.region,
            version: job.token,
            ordinal,
            mediaType: 'tv',
            tmdbId: ordinal + 1,
          });
      });
    await t.run(async (ctx) => {
      const catalog = await ctx.db.query('calendarMonths').first();
      await ctx.db.patch(catalog!._id, { stagingCount: 9000, discoveryPage: 301 });
      await ctx.db.insert('items', item(userId, 9030));
    });
    const pageArgs = { month: job.month, region: 'CA', userId, mediaType: 'tv' as const };
    expect(await t.query(internal.calendarCatalog.page, { ...pageArgs, offset: 0 })).toMatchObject({
      catalog: null,
      titles: [],
    });
    const fetch = vi.fn(async (input: string) => {
      expect(new URL(input).searchParams.get('page')).toBe('301');
      return new Response(
        JSON.stringify({
          total_pages: 301,
          // Include a repeated candidate to exercise deduplication against staged rows.
          results: Array.from({ length: 31 }, (_, i) => ({ id: 9000 + i })),
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    await t.action(internal.calendarDiscovery.continueDiscovery, job);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await t.run((ctx) => ctx.db.query('calendarMonths').first())).toMatchObject({
      candidateCount: 9030,
      candidates: [],
      version: 'worker',
    });
    expect(await t.query(internal.calendarRefresh.progress, job)).toBeNull();
    const tail = await t.query(internal.calendarCatalog.page, { ...pageArgs, offset: 9000 });
    expect(tail.titles.map((entry) => entry.item.tmdbId)).toEqual([9030]);
    expect(tail.nextOffset).toBeNull();
    const candidates = await t.run((ctx) => ctx.db.query('calendarCandidates').collect());
    expect(candidates).toHaveLength(9030);
    expect(new Set(candidates.map((candidate) => candidate.tmdbId)).size).toBe(9030);
  }, 15_000);
  it('takes over an expired lease at its checkpoint and fences the abandoned worker', async () => {
    const { t } = await fixture();
    await t.mutation(internal.calendarCatalog.claim, job);
    expect(await t.mutation(internal.calendarCatalog.claim, { ...job, token: 'contender' })).toBe(
      false,
    );
    await t.mutation(internal.calendarRefresh.checkpoint, {
      ...job,
      feed: 0,
      page: 1,
      totalPages: 3,
      candidates: [{ tmdbId: 1, mediaType: 'tv' }],
    });
    vi.setSystemTime(now + 120_001);
    await t.mutation(internal.calendarRefresh.recover, job);
    const row = await t.run((ctx) => ctx.db.query('calendarMonths').first());
    expect(row).toMatchObject({ discoveryPage: 2, stagingCount: 1, stagingVersion: 'worker' });
    expect(row!.leaseToken).not.toBe(job.token);
    expect(await t.query(internal.calendarRefresh.progress, job)).toBeNull();
    expect(
      await t.mutation(internal.calendarRefresh.checkpoint, {
        ...job,
        feed: 0,
        page: 2,
        totalPages: 3,
        candidates: [{ tmdbId: 2, mediaType: 'tv' }],
      }),
    ).toBe(false);
    expect(
      await t.query(internal.calendarRefresh.progress, { ...job, token: row!.leaseToken! }),
    ).toEqual({ feed: 0, page: 2 });
  });
  it.each([{ total_pages: 501, results: [] }, { bad: true }])(
    'stops invalid discovery without retry loops',
    async (payload) => {
      const { t, asUser } = await fixture(21);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload))),
      );
      await t.mutation(internal.calendarCatalog.claim, job);
      await t.action(internal.calendarDiscovery.continueDiscovery, job);
      expect(await t.query(internal.calendarRefresh.progress, job)).toBeNull();
      const row = await t.run((ctx) => ctx.db.query('calendarMonths').first());
      expect(row!.discoveryError).toBeTruthy();
      expect(row!.discoveryRetryAt).toBeGreaterThan(now);
      expect(await t.mutation(internal.calendarCatalog.claim, { ...job, token: 'retry' })).toBe(
        false,
      );
      await expect(asUser.action(api.calendar.upcoming, window)).rejects.toThrow(/discovery/);
    },
  );
  it('bounds consecutive transient failures while keeping the last complete catalog', async () => {
    const { t, asUser, userId } = await fixture(21);
    await seedCatalog(t);
    vi.setSystemTime(now + 7 * 60 * 60_000);
    await write(t, [release(1)]);
    await t.run(async (ctx) => {
      await ctx.db.insert('items', { ...item(userId, 99), mediaType: 'movie' });
      await ctx.db.insert('calendarSchedules', {
        key: 'CA:2026-10:movie:99:',
        month: job.month,
        events: [{ id: 'movie:99', date: '2026-10-12', kind: 'movie' }],
        refreshedAt: Date.now(),
      });
    });
    await t.mutation(internal.calendarCatalog.claim, job);
    for (let attempt = 0; attempt < 5; attempt++)
      await t.mutation(internal.calendarRefresh.failed, {
        ...job,
        feed: 0,
        page: 1,
        permanent: false,
        message: 'offline',
      });
    expect(await t.query(internal.calendarRefresh.progress, job)).toBeNull();
    expect(
      await t.query(internal.calendarCatalog.metadata, { month: job.month, region: job.region }),
    ).toMatchObject({
      version: 'ready',
      error: 'offline',
    });
    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    expect(
      scheduled.filter((fn) => fn.name === 'calendarDiscovery:continueDiscovery'),
    ).toHaveLength(5);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const saved = await loadCalendarPages(
      (args) => asUser.action(api.calendar.upcoming, args),
      window,
      () => {},
    );
    expect(saved.events.map((event) => event.id).sort()).toEqual(
      [release(1).id, 'movie:99'].sort(),
    );
    expect(saved.needsRefresh).toBe(true);
    expect(saved.failedTitles.count).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bounded release storage and responses', () => {
  it('stores and pages 9000 events from one title without truncation or oversized arrays', async () => {
    const { t, asUser } = await fixture();
    await seedCatalog(t);
    await write(
      t,
      Array.from({ length: 9000 }, (_, i) => release(i + 1)),
    );
    const fetch = vi.fn((args) => asUser.action(api.calendar.upcoming, args));
    const result = await loadCalendarPages(fetch, { ...window, cachedOnly: true }, () => {});
    expect(result.events).toHaveLength(9000);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(9000);
    expect(fetch).toHaveBeenCalledTimes(18);
    for (const result of fetch.mock.results)
      expect((await result.value).events.length).toBeLessThanOrEqual(500);
    const chunks = await t.run((ctx) => ctx.db.query('calendarReleaseChunks').collect());
    expect(chunks).toHaveLength(36);
    expect(chunks.every((chunk) => chunk.events.length <= 250)).toBe(true);
    expect(await t.run((ctx) => ctx.db.query('calendarSchedules').first())).toMatchObject({
      events: [],
      eventCount: 9000,
    });
  });
  it('pages 9000 combined events across 300 titles including title boundaries', async () => {
    const { t, asUser } = await fixture(300);
    await seedCatalog(t, 300);
    await t.run(async (ctx) => {
      for (let id = 1; id <= 300; id++)
        await ctx.db.insert('calendarSchedules', {
          key: `CA:2026-10:tv:${id}:`,
          month: job.month,
          refreshedAt: now,
          events: Array.from({ length: 30 }, (_, i) => ({
            ...release(i + 1),
            id: `episode:${id}:${i + 1}`,
          })),
        });
    });
    const result = await loadCalendarPages(
      (args) => asUser.action(api.calendar.upcoming, args),
      { ...window, cachedOnly: true },
      () => {},
    );
    expect(result.events).toHaveLength(9000);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(9000);
  }, 15_000);
  it('fences schedule changes and never refreshes stale releases during pagination', async () => {
    const { t, asUser } = await fixture();
    await seedCatalog(t);
    await write(
      t,
      Array.from({ length: 700 }, (_, i) => release(i + 1)),
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const first = await asUser.action(api.calendar.upcoming, { ...window, cachedOnly: true });
    await t.run(async (ctx) => {
      const row = await ctx.db.query('calendarSchedules').first();
      await ctx.db.patch(row!._id, { refreshedAt: now - 7 * 60 * 60_000 });
    });
    const second = await asUser.action(api.calendar.upcoming, {
      ...window,
      cursor: first.nextCursor!,
    });
    expect(second.events).toHaveLength(200);
    expect(fetch).not.toHaveBeenCalled();
    await write(t, [release(999)], 'changed');
    await expect(
      asUser.action(api.calendar.upcoming, { ...window, cursor: first.nextCursor! }),
    ).rejects.toThrow('Release dates changed');
  });
  it('keeps old releases until atomic publication and fences superseded partial writes', async () => {
    const { t } = await fixture();
    await write(t, [release(1)]);
    vi.setSystemTime(now + 7 * 60 * 60_000);
    const args = {
      key: 'CA:2026-10:tv:1:',
      month: job.month,
      refreshedAt: Date.now(),
      token: 'abandoned',
    };
    await t.mutation(internal.calendarScheduleStore.begin, args);
    await t.mutation(internal.calendarScheduleStore.writeChunk, {
      ...args,
      chunk: 0,
      done: false,
      events: Array.from({ length: 250 }, (_, i) => release(i + 2)),
    });
    expect(
      (await t.query(internal.calendarScheduleStore.readPage, { key: args.key, offset: 0 })).events,
    ).toEqual([release(1)]);
    const winner = { ...args, token: 'winner', refreshedAt: Date.now() - 6 * 60 * 60_000 };
    expect(await t.mutation(internal.calendarScheduleStore.begin, winner)).toBe(false);
    vi.setSystemTime(Date.now() + 120_001);
    expect(await t.mutation(internal.calendarScheduleStore.begin, winner)).toBe(true);
    expect(
      await t.mutation(internal.calendarScheduleStore.writeChunk, {
        ...args,
        chunk: 1,
        done: true,
        events: [release(999)],
      }),
    ).toBe(false);
    await t.mutation(internal.calendarScheduleStore.discardVersion, {
      key: args.key,
      version: 'abandoned',
    });
    expect(
      (await t.query(internal.calendarScheduleStore.readPage, { key: args.key, offset: 0 })).events,
    ).toEqual([release(1)]);
    await t.mutation(internal.calendarScheduleStore.writeChunk, {
      ...winner,
      chunk: 0,
      done: true,
      events: [release(2)],
    });
    expect(
      (await t.query(internal.calendarScheduleStore.readPage, { key: args.key, offset: 0 })).events,
    ).toEqual([release(2)]);
  });
});

describe('partial season refresh', () => {
  it('accepts moved regular episodes and falls back only for failed specials', async () => {
    const { t, asUser } = await fixture();
    await seedCatalog(t);
    await write(t, [release(1, 1), release(1, 0, '2026-10-13')]);
    await t.run(async (ctx) => {
      const row = await ctx.db.query('calendarSchedules').first();
      await ctx.db.patch(row!._id, { refreshedAt: now - 7 * 60 * 60_000 });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        return new Response(
          JSON.stringify(
            url.searchParams.has('append_to_response')
              ? {
                  'season/1': {
                    episodes: [{ episode_number: 1, season_number: 1, air_date: '2026-10-15' }],
                  },
                }
              : { seasons: [{ season_number: 0 }, { season_number: 1 }] },
          ),
        );
      }),
    );
    const result = await asUser.action(api.calendar.upcoming, window);
    expect(result.events.map((event) => [event.season, event.date])).toEqual([
      [0, '2026-10-13'],
      [1, '2026-10-15'],
    ]);
    expect(result.failedTitles).toEqual({ count: 1, names: ['Show 1'] });
    const saved = await asUser.action(api.calendar.upcoming, { ...window, cachedOnly: true });
    expect(saved.events).toEqual(result.events);
    expect(saved.needsRefresh).toBe(true);
  });
});
