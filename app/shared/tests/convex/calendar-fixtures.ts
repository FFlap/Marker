import type { Doc } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';

export async function seedCalendarCatalog(
  ctx: MutationCtx,
  args: Pick<Doc<'calendarMonths'>, 'month' | 'region' | 'version' | 'refreshedAt'> & {
    candidates: Pick<Doc<'calendarCandidates'>, 'mediaType' | 'tmdbId'>[];
  },
) {
  const { candidates, ...catalog } = args;
  const id = await ctx.db.insert('calendarMonths', {
    ...catalog,
    candidateCount: candidates.length,
  });
  for (const [ordinal, candidate] of candidates.entries())
    await ctx.db.insert('calendarCandidates', {
      month: args.month,
      region: args.region,
      version: args.version,
      ordinal,
      ...candidate,
    });
  return id;
}

export async function seedCalendarSchedule(
  ctx: MutationCtx,
  args: Pick<Doc<'calendarSchedules'>, 'key' | 'month' | 'refreshedAt'> & {
    events: Doc<'calendarReleaseChunks'>['events'];
  },
) {
  const { events, ...schedule } = args;
  const version = 'fixture';
  const id = await ctx.db.insert('calendarSchedules', {
    ...schedule,
    version,
    eventCount: events.length,
  });
  for (let offset = 0; offset < events.length; offset += 250)
    await ctx.db.insert('calendarReleaseChunks', {
      key: args.key,
      month: args.month,
      version,
      chunk: offset / 250,
      events: events.slice(offset, offset + 250),
    });
  return id;
}
