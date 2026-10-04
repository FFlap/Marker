import { ConvexError, type Infer, v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import { requireUser } from './clerkAuth';
import { ensureMonth } from './calendarDiscovery';
import { loadTitleSchedules } from './calendarProviders';
import {
  CALENDAR_TTL_MS,
  dateCursorValidator,
  legacyCursorValidator,
  eventValidator,
  isDate,
  inRange,
  monthEnd,
  scheduleKey,
  type CalendarEvent,
} from './calendarTypes';

const resultValidator = v.object({
  events: v.array(eventValidator),
  truncated: v.boolean(),
  failedTitles: v.object({ count: v.number(), names: v.array(v.string()) }),
  region: v.string(),
  nextCursor: v.union(dateCursorValidator, v.null()),
  retryAfterMs: v.optional(v.number()),
  refreshPending: v.optional(v.boolean()),
  needsRefresh: v.optional(v.boolean()),
});

export const upcoming = action({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    region: v.optional(v.string()),
    cursor: v.optional(v.union(dateCursorValidator, legacyCursorValidator)),
    timeZoneOffsetMinutes: v.optional(v.number()),
    cachedOnly: v.optional(v.boolean()),
  },
  returns: resultValidator,
  handler: async (
    ctx,
    {
      startDate,
      endDate,
      region: rawRegion,
      cursor,
      timeZoneOffsetMinutes = 0,
      cachedOnly = false,
    },
  ): Promise<Infer<typeof resultValidator>> => {
    const userId = await requireUser(ctx);
    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate)
      throw new Error('Invalid calendar date range');
    if (
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 >
      93
    )
      throw new Error('Calendar ranges are limited to 93 days');
    if (!Number.isFinite(timeZoneOffsetMinutes) || Math.abs(timeZoneOffsetMinutes) > 14 * 60)
      throw new Error('Invalid calendar time zone');
    const region = /^[A-Za-z]{2}$/.test(rawRegion ?? '') ? rawRegion!.toUpperCase() : 'US';
    const currentMonth = new Date(Date.now() - timeZoneOffsetMinutes * 60_000)
      .toISOString()
      .slice(0, 7);
    const empty = {
      events: [],
      truncated: false,
      failedTitles: { count: 0, names: [] },
      region,
      nextCursor: null,
    };
    if (endDate < `${currentMonth}-01`) return empty;
    startDate = startDate < `${currentMonth}-01` ? `${currentMonth}-01` : startDate;
    // Old clients can retry after the date-index rollout instead of silently skipping titles.
    if (cursor && !('month' in cursor)) throw new Error('Calendar loading changed. Please retry.');
    const month = cursor?.month ?? startDate.slice(0, 7);
    if (!isDate(`${month}-01`) || month < startDate.slice(0, 7) || month > endDate.slice(0, 7))
      throw new Error('Invalid calendar cursor');
    let mediaType = cursor?.mediaType ?? 'tv';
    const pageArgs = {
      mediaType,
      userId,
      month,
      region,
      offset: cursor?.offset ?? 0,
      ...(cursor?.version && { version: cursor.version }),
    };
    let page = await ctx.runQuery(internal.calendarCatalog.page, pageArgs);
    if (page.emptyLibrary && page.nextMediaType) {
      mediaType = page.nextMediaType;
      pageArgs.mediaType = mediaType;
      pageArgs.offset = 0;
      delete pageArgs.version;
      page = await ctx.runQuery(internal.calendarCatalog.page, pageArgs);
    }
    if (
      !page.emptyLibrary &&
      !cachedOnly &&
      !cursor?.version &&
      (!page.catalog || page.catalog.refreshedAt <= Date.now() - CALENDAR_TTL_MS)
    ) {
      try {
        await ensureMonth(ctx, month, region, mediaType);
      } catch (error) {
        if (
          error instanceof ConvexError &&
          typeof error.data === 'object' &&
          (error.data?.code === 'provider_global_limiter' ||
            error.data?.code === 'calendar_refresh_pending')
        )
          return {
            ...empty,
            refreshPending: true,
            retryAfterMs: error.data.code === 'provider_global_limiter' ? 60_000 : 1_000,
            failedTitles: { count: 1, names: [] },
          };
        throw error;
      }
      page = await ctx.runQuery(internal.calendarCatalog.page, pageArgs);
    }
    const [year, number] = month.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
    const nextCursor: Infer<typeof dateCursorValidator> | null =
      page.nextOffset !== null && page.catalog
        ? { month, mediaType, offset: page.nextOffset, version: page.catalog.version }
        : page.nextMediaType
          ? { month, mediaType: page.nextMediaType, offset: 0, version: '' }
          : nextMonth <= endDate.slice(0, 7)
            ? { month: nextMonth, offset: 0, version: '' }
            : null;
    let needsRefresh =
      !page.emptyLibrary &&
      (!page.catalog || page.catalog.refreshedAt <= Date.now() - CALENDAR_TTL_MS);
    const events: CalendarEvent[] = [];
    const pending = [];
    for (const entry of page.titles) {
      if (entry.saved && (cachedOnly || entry.saved.refreshedAt > Date.now() - CALENDAR_TTL_MS)) {
        events.push(...entry.saved.events.map((event) => ({ ...entry.item, ...event })));
        needsRefresh ||= entry.saved.refreshedAt <= Date.now() - CALENDAR_TTL_MS;
      } else pending.push(entry.item);
    }
    const loaded = await loadTitleSchedules(
      ctx,
      pending,
      `${month}-01`,
      monthEnd(month),
      region,
      cachedOnly,
    );
    const savedByKey = new Map(
      page.titles.map((entry) => [scheduleKey(month, region, entry.item), entry.saved]),
    );
    const failedNames: string[] = [];
    const writes = [];
    for (const result of loaded.results) {
      needsRefresh ||= result.needsRefresh;
      const key = scheduleKey(month, region, result.item);
      const previous = savedByKey.get(key);
      const releases =
        result.failed && previous
          ? previous.events.map((event) => ({ ...result.item, ...event }))
          : result.events;
      events.push(...releases);
      if (result.failed) failedNames.push(result.item.title);
      if (!result.failed && !result.needsRefresh) {
        // Shared storage contains release facts only; user titles and membership are joined on read.
        writes.push({
          key,
          month,
          refreshedAt: result.refreshedAt,
          events: result.events.map(({ id, date, kind, season, episode, episodeName }) => ({
            id,
            date,
            kind,
            ...(season !== undefined && { season }),
            ...(episode !== undefined && { episode }),
            ...(episodeName !== undefined && { episodeName }),
          })),
        });
      }
    }
    for (let offset = 0; offset < writes.length; offset += 20)
      await ctx.runMutation(internal.calendarCatalog.saveSchedules, {
        entries: writes.slice(offset, offset + 20),
      });
    return {
      events: events
        .filter((event) => inRange(event.date, startDate, endDate))
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
      truncated: nextCursor !== null,
      nextCursor,
      region,
      failedTitles: { count: failedNames.length, names: failedNames.slice(0, 5) },
      ...(cachedOnly && { needsRefresh }),
      ...(loaded.retryAfterMs && { retryAfterMs: loaded.retryAfterMs }),
    };
  },
});
